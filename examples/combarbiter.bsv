import Vector::*;

//typedef struct {
// Bool valid;
// Bit#(31) data;
// Bit#(4) index;
//} ResultArbiter deriving (Eq, FShow);

function ResultArbiter arbitrate(Vector#(16, Bit#(1)) ready, Vector#(16, Bit#(31)) data);
    ResultArbiter ra = ResultArbiter{valid: False, data : 0, index: 0};
	if (!ra.valid && unpack(ready[i])) ra = ResultArbiter{valid: True, data: data[i], index: fromInteger(i)};
	return ra;
endfunction