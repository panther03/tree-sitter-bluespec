import sys
from antlr4 import *
from ANTLRv4Lexer import ANTLRv4Lexer
from ANTLRv4Parser import ANTLRv4Parser
from ANTLRv4ParserVisitor import ANTLRv4ParserVisitor

class G42JS(ANTLRv4ParserVisitor):
    code = "var rules = {\n"
    lexercode = ""

    def visitGrammarSpec(self, ctx:ANTLRv4Parser.GrammarSpecContext):
        #self.code += ctx.grammarDecl().identifier().getText()
        self.visitChildren(ctx)
        self.code += self.lexercode 
        self.code += "}"
        

    def visitParserRuleSpec(self, ctx: ANTLRv4Parser.RuleSpecContext):
        ref = ctx.RULE_REF().getText()
        self.code += f"{ref}: $ => "
        self.visitChildren(ctx)
        self.code += ",\n"

    def visitLexerRuleSpec(self, ctx: ANTLRv4Parser.LexerRuleSpecContext):
        ref = ctx.TOKEN_REF().getText()
        self.lexercode += f"{ref}: $ => \"a\", // fixme\n"
#        self.ignore = True
#        self.visitChildren(ctx)
#        if not self.ignore:
#            self.code += f"{self.temprule},\n"

    def visitLexerAltList(self, ctx: ANTLRv4Parser.LexerAltListContext):
        alts = ctx.lexerAlt()
        if len(alts) > 1:
            self.temprule += "choice(\n"
            for alt in alts:
                if not alt.lexerCommands() or ("skip" not in alt.lexerCommands().getText()):
                    self.ignore = False
                self.visitLexerAlt(alt)
                self.temprule += ",\n"
            self.temprule += ")"
        else:
            self.visitLexerAlt(alts[0])

    def visitLexerElements(self,  ctx: ANTLRv4Parser.LexerElementsContext):
        elems = ctx.lexerElement()
        if len(elems) > 1:
            self.temprule += "seq(\n"
            for elem in elems:
                self.visitLexerElement(elem)
                self.temprule += ",\n"
            self.temprule += ")"
        else:
            self.visitLexerElement(elems[0])

    def visitLexerElement(self, ctx: ANTLRv4Parser.LexerElementContext):
        self.temprule += ctx.getText()

    def visitRuleAltList(self, ctx: ANTLRv4Parser.RuleAltListContext):
        alts = ctx.labeledAlt()
        if len(alts) > 1:
            self.code += "choice(\n"
            for alt in alts:
                self.visitLabeledAlt(alt)
                self.code += ",\n"
            self.code += ")"
        else:
            self.visitLabeledAlt(alts[0])

    def visitAltList(self, ctx: ANTLRv4Parser.AltListContext):
        alts = ctx.alternative()
        if len(alts) > 1:
            self.code += "choice(\n"
            for alt in alts:
                self.visitAlternative(alt)
                self.code += ",\n"
            self.code += ")"
        else:
            self.visitAlternative(alts[0])

    def visitLabeledAlt(self, ctx: ANTLRv4Parser.LabeledAltContext):
        if ctx.identifier():
            print("fuck")
            sys.exit(1)
        self.visitAlternative(ctx.alternative())
        #return super().visitLabeledAlt(ctx)
        
    def visitAlternative(self, ctx: ANTLRv4Parser.AlternativeContext):
        elems = ctx.element()
        if len(elems) > 1:
            self.code += "seq(\n"
            for elem in elems:
                self.visitElement(elem)
                self.code += ",\n"
            self.code += ")"
        else:
            self.visitElement(elems[0])
    
    def visitElement(self, ctx: ANTLRv4Parser.ElementContext):
        if (a := ctx.atom()) is not None:
            after = self.handleSuffix(ctx.ebnfSuffix())
            if len(a.getText()) > 0 and a.getText()[0].isalpha():
                self.code += "$."
            self.code += a.getText()
            after()
        elif (e := ctx.ebnf()) is not None:
            self.visitEbnf(e)
        else:
            print("fuckshit")
            sys.exit(1)

    def visitLexerElement(self, ctx: ANTLRv4Parser.LexerElementContext):
        if (a := ctx.lexerAtom()) is not None:
            after = self.handleSuffix(ctx.ebnfSuffix(), temprule=True)
            a_text = a.getText()
            regexWrap = True
            if len(a_text) >= 2 and a_text[0] == '\'' and a_text[-1] == '\'':
                a_text = a_text[1:-1]
            elif len(a_text) >= 1 and a_text[0].isupper():
                regexWrap = False
            if regexWrap:
                a_text = f"/{a_text}/"
            self.temprule += a_text

            after()
        elif (b := ctx.lexerBlock()) is not None:
            after = self.handleSuffix(ctx.ebnfSuffix(), temprule=True)
            self.visitLexerAltList(b.lexerAltList())
            after()
        else:
            print("fuckshit")
            sys.exit(1)

    def handleSuffix(self, ctx, temprule=False): 
        dst = self.temprule if temprule else self.code
        if ctx:
            if ctx.QUESTION():
                self.code += "optional("
            elif ctx.STAR(): 
                self.code  += "repeat("
            elif ctx.PLUS():
                self.code += "repeat1("
            def um():
                self.code += ')'
            return um
        else:
            return lambda: 0

    def visitEbnf(self, ctx: ANTLRv4Parser.EbnfContext):
        suffix = None
        if ctx.blockSuffix():
            suffix = ctx.blockSuffix().ebnfSuffix()
        after = self.handleSuffix(suffix)
        self.visitAltList(ctx.block().altList())
        after()


def main(argv):
    input_stream = FileStream(argv[1])
    lexer = ANTLRv4Lexer(input_stream)
    stream = CommonTokenStream(lexer)
    parser = ANTLRv4Parser(stream)
    tree = parser.grammarSpec()
    if parser.getNumberOfSyntaxErrors() > 0:
        print("syntax errors")
    else:
        g42js = G42JS()
        g42js.visit(tree)
        print(g42js.code)

if __name__ == '__main__':
    main(sys.argv)

