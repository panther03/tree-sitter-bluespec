//`define KONATA_ENABLE
//`define DEBUG_ENABLE

import FIFO::*;
import FIFOF::*;
import SpecialFIFOs::*;
import RegFile::*;
import RVUtil::*;
import Vector::*;
`ifdef KONATA_ENABLE
import KonataHelper::*;
`endif
import Printf::*;
import Ehr::*;


typedef struct { Bit#(4) byte_en; Bit#(32) addr; Bit#(32) data; } Mem deriving (Eq, FShow, Bits);


interface RVIfc#(numeric type n);
    method ActionValue#(Mem) getIReq();
    method Action getIResp(Mem a);
    method ActionValue#(Mem) getDReq();
    method Action getDResp(Mem a);
    method ActionValue#(Mem) getMMIOReq();
    method Action getMMIOResp(Mem a);
endinterface

interface Scoreboard;
    method Action insert(Bit#(5) dst);
    method Action remove(Bit#(5) dst);
    method ActionValue#(Bool) search(Bit#(5) src);
endinterface

module mkScoreboardBoolFlags(Scoreboard); 
    Vector#(32,Ehr#(2, Bool)) ready <- replicateM(mkEhr(True));

    method Action insert(Bit#(5) dst);
        ready[dst][1] <= False;
    endmethod

    method Action remove(Bit#(5) dst);
        ready[dst][0] <= True;
    endmethod

    method ActionValue#(Bool) search(Bit#(5) src);
        return ready[src][0];
    endmethod
endmodule

// typedef struct { Bit#(4) byte_en; Bit#(32) addr; Bit#(32) data; } Mem deriving (Eq, FShow, Bits);
typedef struct { Bool isUnsigned; Bit#(2) size; Bit#(2) offset; Bool mmio; } MemBusiness deriving (Eq, FShow, Bits);

function Bool isMMIO(Bit#(32) addr);
    /*Bool x = case (addr) 
        32'hf000fff0: True;
        32'hf000fff4: True;
        32'hf000fff8: True;
        default: False;
    endcase;*/
    // simplifying assumption
    return addr[31:29] == 3'h7;
endfunction

typedef struct { Bit#(32) pc;
                 Bit#(32) ppc;
                 Bit#(1) epoch; 
                 Bit#(1) thread_id;
`ifdef KONATA_ENABLE
                 KonataId k_id; // <- This is a unique identifier per instructions, for logging purposes
`endif
             } F2D deriving (Eq, FShow, Bits);

typedef struct { 
    DecodedInst dinst;
    Bit#(32) pc;
    Bit#(32) ppc;
    Bit#(1) epoch;
    Bit#(32) rv1; 
    Bit#(32) rv2; 
    Bit#(1) thread_id;
`ifdef KONATA_ENABLE
    KonataId k_id; // <- This is a unique identifier per instructions, for logging purposes
`endif
    } D2E deriving (Eq, FShow, Bits);

typedef struct { 
    MemBusiness mem_business;
    Bit#(32) data;
    DecodedInst dinst;
    Bool poisoned;
    Bit#(1) thread_id;
`ifdef KONATA_ENABLE
    KonataId k_id; // <- This is a unique identifier per instructions, for logging purposes
`endif
} E2W deriving (Eq, FShow, Bits);

//(* synthesize *)
module mkPipelined (RVIfc#(n));
    // Interface with memory and devices
    FIFO#(Mem) toImem <- mkBypassFIFO;
    FIFO#(Mem) fromImem <- mkBypassFIFO;
    FIFO#(Mem) toDmem <- mkFIFO;
    FIFOF#(Mem) fromDmem <- mkBypassFIFOF;
    FIFO#(Mem) toMMIO <- mkFIFO;
    FIFO#(Mem) fromMMIO <- mkBypassFIFO;

    Integer numThreads = valueOf(n);
    Vector#(n, Ehr#(2, Bit#(32))) pcs <- replicateM(mkEhr(32'h0));
    Vector#(n, Ehr#(2, Bit#(1))) epochs <- replicateM(mkEhr(1'h0));
    Vector#(n, Vector#(32, Reg#(Bit#(32)))) rfs <- replicateM(replicateM(mkReg(32'h0)));
    Vector#(n, Scoreboard) scs <- replicateM(mkScoreboardBoolFlags);

    RWire#(Bit#(6)) decodeSCPort <- mkRWire;

    Reg#(Bit#(1)) lastFetchedThread <- mkReg(fromInteger(numThreads - 1));

    FIFO#(F2D) f2d <- mkFIFO;
    FIFO#(D2E) d2e <- mkFIFO;
    FIFOF#(E2W) e2w <- mkFIFOF;

    Reg#(Bool) starting <- mkReg(True);

    rule init if (starting);
        starting <= False;
        for (Integer i = 1; i < numThreads; i = i + 1) begin
            rfs[i][fromInteger(i)] <= pack(10);
        end
    endrule

`ifdef KONATA_ENABLE
	// Code to support Konata visualization
    String dumpFile = "output.log";
    let lfh <- mkReg(InvalidFile);
	Reg#(KonataId) fresh_id <- mkReg(0);
	Reg#(KonataId) commit_id <- mkReg(0);

	FIFO#(KonataId) retired <- mkFIFO;
	FIFO#(KonataId) squashed <- mkFIFO;

    rule do_tic_logging;
        if (starting) begin
            let f <- $fopen(dumpFile, "w") ;
            lfh <= f;
            $fwrite(f, "Kanata\t0004\nC=\t1\n");
        end
		konataTic(lfh);
	endrule
`endif

`ifdef DEBUG_ENABLE
    Reg#(Bit#(32)) cyc <- mkReg(0);
    rule cyc_count_debug;
        cyc <= cyc + 1;
    endrule
`endif

	for (Integer thread = 0; thread < numThreads; thread = thread + 1) begin
        Integer prevThread = (thread == 0) ? (numThreads-1) : (thread - 1);
        rule fetch if (!starting && (lastFetchedThread == fromInteger(prevThread)));
        // Fetch PC including bypassed result from execute
        Bit#(32) pc_next = pcs[thread][0] + 4;

        // Update PC register based on calculated next
        // This will include the bypassed jump target
        pcs[thread][0] <= pc_next; 

        // Mem should also initiate a request from the bypass
        let req = Mem {byte_en: 0, addr: pcs[thread][0], data: ?};
        toImem.enq(req);

`ifdef KONATA_ENABLE
        // Trigger konata
        let iid <- fetch1Konata(lfh, fresh_id, 0);
        labelKonataLeft(lfh, iid, $format("0x%x: ", pcs[thread][0]));
`endif

`ifdef DEBUG_ENABLE 
        $display("(cyc=%d) [Fetch] thread=0", cyc, fshow(pcs[thread][0]));
`endif

        // Enqueue to the next pipeline stage
        f2d.enq(F2D{
            pc: pc_next, // NEXT pc
            ppc: pcs[thread][0], // PREVIOUS pc
`ifdef KONATA_ENABLE
            k_id: iid,
`endif
            epoch: epochs[thread][0],
            thread_id: 0
        });
        lastFetchedThread <= fromInteger(thread);
        endrule
    end


    rule decode if (!starting);
        // Check for operands being ready without dequeueing.
        // RS1 and RS2 need to be ready for RAW hazards,
        // while we need to wait on RD for a WAR hazard,
        // which here is only applicable when two insructions write to the same
        // register back-to-back and then after the register is read.
        let resp = fromImem.first();
        let instr = resp.data;
        let decodedInst = decodeInst(resp.data);
        let fetchedInstr = f2d.first();
        let thread = fetchedInstr.thread_id;
        let rs1_idx = getInstFields(instr).rs1;
        let rs2_idx = getInstFields(instr).rs2;
        let rd_idx = getInstFields(instr).rd;
        let rs1_rdy <- scs[thread].search(rs1_idx);
        let rs2_rdy <- scs[thread].search(rs2_idx);

        //if (debug) $display("(cyc=%d) [Pre-Decode] [%d,%d,%d] ", cyc, rs1_rdy, rs2_rdy, rd_rdy, fshow(getInstFields(instr)));
     
        if ((rs1_rdy) && (rs2_rdy)) begin
            // Dequeue IMEM result with pipeline register, keeping them in-sync
            fromImem.deq();
            f2d.deq();

`ifdef DEBUG_ENABLE
            $display("(cyc=%d) [Decode] ", cyc, fshow(thread));
`endif

            // 0 is hard-wired to 0 val in RISC-V
            let rs1 = (rs1_idx == 0 ? 0 : rfs[thread][rs1_idx]);
            let rs2 = (rs2_idx == 0 ? 0 : rfs[thread][rs2_idx]);

            // RD is now busy in the scoreboard
            if (rd_idx != 0 && decodedInst.valid_rd) begin
                decodeSCPort.wset({thread,rd_idx});
                // $display("(cyc=%d) inserting %d", cyc, rd_idx);
            end

`ifdef KONATA_ENABLE
                decodeKonata(lfh, fetchedInstr.k_id);
                labelKonataLeft(lfh,fetchedInstr.k_id, $format("RD=%d | rf[RS1=%d]=%x | rf[RS2=%d]=%d", rd_idx, rs1_idx, rs1, rs2_idx, rs2));
`endif

            // Ready to execute; enqueue to next pipeline stage
            d2e.enq(D2E{
                dinst: decodedInst,
                pc: fetchedInstr.pc,
                ppc: fetchedInstr.ppc,
`ifdef KONATA_ENABLE
                k_id: fetchedInstr.k_id,
`endif
                epoch: fetchedInstr.epoch,
                rv1: rs1,
                rv2: rs2,
                thread_id: thread
            });
        end
    endrule

    rule scoreboardInsert if (!starting);
        if (isValid(decodeSCPort.wget())) begin
            Bit#(6) portVal = fromMaybe(6'h0, decodeSCPort.wget());
            scs[portVal[5]].insert(portVal[4:0]);
        end
    endrule

    rule execute if (!starting);
        // Dequeue from previous pipeline stage
        let decodedInstr = d2e.first();
        d2e.deq();
        let dInst = decodedInstr.dinst;
        let thread = decodedInstr.thread_id;

`ifdef KONATA_ENABLE
        // Mark instruction in konata
        let current_id = decodedInstr.k_id;
    	executeKonata(lfh, current_id);
`endif
`ifdef DEBUG_ENABLE
        $display("(cyc=%d) [Execute] ", cyc, fshow(thread));
`endif

		let imm = getImmediate(dInst);
        let rv1 = decodedInstr.rv1;
        let rv2 = decodedInstr.rv2;
		Bool mmio = False;
        let instr_pc = decodedInstr.ppc; // we reference from the CURRENT (i.e. previous) PC
		let data = execALU32(dInst.inst, decodedInstr.rv1, decodedInstr.rv2, imm, instr_pc);
		let isUnsigned = 0;
		let funct3 = getInstFields(dInst.inst).funct3;
		let size = funct3[1:0];
		let addr = rv1 + imm;
		Bit#(2) offset = addr[1:0];

        let controlResult = execControl32(dInst.inst, rv1, rv2, imm, instr_pc);

        // Detect squashed instructions. We poison them so we can 
        // simply drop the instructions in writeback, freeing the 
        // scoreboard entry as we would normally.
        let poisoned = False;
        if (epochs[thread][0] != decodedInstr.epoch) begin
`ifdef KONATA_ENABLE
            squashed.enq(current_id);
`endif
            poisoned = True;

        // Poisoned instructions can't invalidate the epoch!
        // Also, we can just use taken as a trigger for a misprediction, since we always predict not taken.
        end else if (controlResult.taken) begin  
            pcs[thread][1] <= controlResult.nextPC; 
            epochs[thread][0] <= ~epochs[thread][0];
        end

		if (isMemoryInst(dInst) && !poisoned) begin
			// Technical details for load byte/halfword/word
		    let shift_amount = {offset, 3'b0};
		    let byte_en = 0;
		    case (size) matches
			2'b00: byte_en = 4'b0001 << offset;
			2'b01: byte_en = 4'b0011 << offset;
			2'b10: byte_en = 4'b1111 << offset;
		    endcase
		    data = rv2 << shift_amount;
		    addr = {addr[31:2], 2'b0};
		    isUnsigned = funct3[2];
		    let type_mem = (dInst.inst[5] == 1) ? byte_en : 0;
		    let req = Mem {byte_en : type_mem,
				       addr : addr,
				       data : data};
`ifdef DEBUG_ENABLE
                $display("[Execute] Memory, addr=%x", addr);
`endif
		    if (isMMIO(addr)) begin 
`ifdef DEBUG_ENABLE
		        $display("[Execute] MMIO", fshow(req));
`endif
				toMMIO.enq(req);
`ifdef KONATA_ENABLE
                labelKonataLeft(lfh,current_id, $format(" (MMIO)", fshow(req)));
`endif
    		    mmio = True;
		    end else begin 
`ifdef KONATA_ENABLE
                labelKonataLeft(lfh,current_id, $format(" (MEM)", fshow(req)));
`endif
    		    toDmem.enq(req);
		    end
		end
		else if (isControlInst(dInst)) begin
`ifdef KONATA_ENABLE
            labelKonataLeft(lfh,current_id, $format(" (CTRL)"));
`endif
            data = instr_pc + 4;
		end else begin 
`ifdef KONATA_ENABLE
            labelKonataLeft(lfh,current_id, $format(" (ALU)"));
`endif
		end

        

        e2w.enq(E2W{
            mem_business: MemBusiness{isUnsigned: unpack(isUnsigned), size: size, offset: offset, mmio: mmio},
            data: data,
            dinst: dInst,
`ifdef KONATA_ENABLE
            k_id: current_id,
`endif
            thread_id: thread,
            poisoned: poisoned
        });
        
    endrule

    rule writeback if (!starting);
        // Dequeue from previous pipeline stage
        // $display("E2W: %d; memResp: %d", e2w.notEmpty(), fromDmem.notEmpty());
        let executedInstr = e2w.first();
        e2w.deq();
        let dInst = executedInstr.dinst;
        let thread = executedInstr.thread_id;
        let data = executedInstr.data;
        let mem_business = executedInstr.mem_business;
        let poisoned = executedInstr.poisoned;
        let fields = getInstFields(dInst.inst);

`ifdef KONATA_ENABLE
        let current_id = executedInstr.k_id;
        if (!poisoned) begin
            writebackKonata(lfh,current_id);
            retired.enq(current_id);

            if (dInst.valid_rd) begin
              labelKonataLeft(lfh,current_id, $format("RF [%d]=%d", fields.rd, data));
            end
        end
`endif

`ifdef DEBUG_ENABLE
		if(!poisoned) begin
             $display("(cyc=%d) [Writeback] data=%d t=", cyc, data, fshow(thread));
        end
`endif

        
        if (isMemoryInst(dInst) && !poisoned) begin // (* // write_val *)
            let resp = ?;
		    if (mem_business.mmio) begin 
                resp = fromMMIO.first();
		        fromMMIO.deq();
		    end else begin 
                resp = fromDmem.first();
		        fromDmem.deq();
		    end
            let mem_data = resp.data;
            mem_data = mem_data >> {mem_business.offset ,3'b0};
            case ({pack(mem_business.isUnsigned), mem_business.size}) matches
	     	3'b000 : data = signExtend(mem_data[7:0]);
	     	3'b001 : data = signExtend(mem_data[15:0]);
	     	3'b100 : data = zeroExtend(mem_data[7:0]);
	     	3'b101 : data = zeroExtend(mem_data[15:0]);
	     	3'b010 : data = mem_data;
             endcase
		end

        // TODO: fix this fault logic so bluespec doesnt complain
        //if (!dInst.legal) begin
		//	if (debug) $display("[Writeback] Illegal Inst, Drop and fault: ", fshow(dInst));
		//	pc[0] <= 0;	// Fault
	    //end
		if (dInst.valid_rd) begin
            let rd_idx = fields.rd;
            if (rd_idx != 0) begin 
                if (!poisoned) begin 
                    rfs[thread][rd_idx] <= data;
                end
                // $display("(cyc=%d) removing %d", cyc, rd_idx);
                scs[thread].remove(rd_idx);
            end
		end

	endrule
		

	// ADMINISTRATION:

`ifdef KONATA_ENABLE
    rule administrative_konata_commit;
		    retired.deq();
		    let f = retired.first();
		    commitKonata(lfh, f, commit_id);
	endrule
		
	rule administrative_konata_flush;
		    squashed.deq();
		    let f = squashed.first();
		    squashKonata(lfh, f);
	endrule
`endif
		
    method ActionValue#(Mem) getIReq();
		toImem.deq();
		return toImem.first();
    endmethod
    method Action getIResp(Mem a);
    	fromImem.enq(a);
    endmethod
    method ActionValue#(Mem) getDReq();
		toDmem.deq();
		return toDmem.first();
    endmethod
    method Action getDResp(Mem a);
		fromDmem.enq(a);
    endmethod
    method ActionValue#(Mem) getMMIOReq();
		toMMIO.deq();
		return toMMIO.first();
    endmethod
    method Action getMMIOResp(Mem a);
		fromMMIO.enq(a);
    endmethod
endmodule