function genericIf(rules, ctxt) {
  rules[`${ctxt}\$If`] = ($) => seq("if", '(', $[`${ctxt}\$Stmt`], ')')
}

function exprBinop($, prior, ops) {
  return prec.left(prior, seq($.expression, ops, $.expression));
}

const PREC = {
  PARENT: 37,     // () [] :: .                                   Left Highest
  // TODO: not all unaries have the same precedence in the spec?
  UNARY: 36,      // + - ! ~ & ~& | ~| ^ ~^ ^~ (unary)
  MUL: 34,        // * / %                                        Left
  ADD: 33,        // + - (binary)                                 Left
  SHIFT: 32,      // << >>                                        Left
  RELATIONAL: 31, // < <= > >=                                    Left
  EQUAL: 30,     // == !=                                        Left
  AND: 29,        // & (binary)                                   Left
  XOR: 28,        // ^                                            Left
  XNOR: 27,       // ~^ ^~ (binary)                               Left
  OR: 26,         // | (binary)                                   Left

  LOGICAL_AND: 25, // &&                                           Left
  LOGICAL_OR: 24, // ||                                           Left
  CONDITIONAL: 23, // ?: (conditional operator)                    Right
  IMPLICATION: 22, // –> <–>                                       Right
  ASSIGN: 21,     // = += -= *= /= %= &= ^= |= <<= >>= <<<= >>>= := :/ <= None
  CONCAT: 20,     // {} {{}}                            Concatenation   Lowest
};

var rules = {
  // Top rule
  source_file: $ => choice(
    $.package,
    seq(
      repeat($.exportDecl),
      repeat($.importDecl),
      repeat($.packageStmt),
    ),
  ),


  // Section 2.1
  // Comments

  // Same as in Verilog
  // comment: $ => one_line_comment | block_comment
  // one_line_comment: $ => // comment_text \n
  // block_comment: $ => /* comment_text */
  // comment_text: $ => { Any_ASCII_character }

  // http://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890
  // from: https://github.com/tree-sitter/tree-sitter-c/blob/master/grammar.js
  comment: $ => token(choice(
    seq('//', /.*/),
    seq(
      '/*',
      /[^*]*\*+([^/*][^*]*\*+)*/,
      '/'
    )
  )),

  // Section 2.2
  // Identifiers

  identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_$]*/,
  Identifier: ($) => /[A-Z_][a-zA-Z0-9_$]*/,

  // Section 2.3
  // Integer Literals
  intLiteral: ($) => choice("'0", "'1",
    $.sizedIntLiteral, $.unsizedIntLiteral),
  sizedIntLiteral: ($) => seq($.bitWidth, $.baseLiteral),
  unsizedIntLiteral: ($) => choice(seq(optional($.sign), $.baseLiteral), seq(optional($.sign), $.decNum)),

  baseLiteral: ($) => choice(
    seq(choice("'d", "'D"), $.decDigitsUnderscore),
    seq(choice("'h", "'H"), $.hexDigitsUnderscore),
    seq(choice("'o", "'O"), $.decDigitsUnderscore),
    seq(choice("'B", "'B"), $.binDigitsUnderscore),
  ),

  decNum: ($) => seq($.decDigits, optional($.decDigitsUnderscore)),

  bitWidth: ($) => alias($.decDigits, $.bitWidth),
  sign: ($) => choice("+", "-"),

  decDigits: ($) => repeat1(/[0-9]/),
  decDigitsUnderscore: ($) => repeat1(/[0-9_]/),
  hexDigitsUnderscore: ($) => repeat1(/[0-9a-fA-F_]/),
  octDigitsUnderscore: ($) => repeat1(/[0-7_]/),
  binDigitsUnderscore: ($) => repeat1(/[0-1_]/),

  // Section 2.4
  // Real Literals

  realLiteral: ($) => choice(
    seq($.decNum, optional(seq('.', $.decDigitsUnderscore)), $.exp, optional($.sign), $.decDigitsUnderscore),
    seq($.decNum, '.', $.decDigitsUnderscore),
  ),
  exp: ($) => choice('e', 'E'),

  // Section 2.5
  // String Literals
  // TODO: the set of allowed characters is probably more than this
  stringLiteral: $ => seq(
    '"', token.immediate(prec(1, /[^\\"\n]+/)), '"'
  ),

  // Section 3
  // Packages and the outermost structure of a BSV design
  package: $ => seq(
    seq("package", $.packageIde, ';'),
    seq(
      repeat($.exportDecl),
      repeat($.importDecl),
      repeat($.packageStmt),
    ),
    seq("endpackage", optional(seq(':', $.packageIde)))
  ),

  exportDecl: $ => seq("export", $.exportItem, repeat(seq(',', $.exportItem)), ';'),
  exportItem: $ => choice(
    seq($.identifier, optional(seq('(', '..', ')'))),
    seq($.Identifier, optional(seq('(', '..', ')'))),
    seq($.packageIde, '::', '*'),
  ),

  importDecl: $ => seq("import", $.importItem, repeat(seq(',', $.importItem)), ';'),
  importItem: $ => seq($.packageIde, '::', '*'),

  packageStmt: $ => choice(
    //seq(optional($.attributeInstances), $.moduleDef),
    //$.interfaceDecl,
    //$.typeDef,
    //$.varDecl,
    $.varAssign,
    //seq(optional($.attributeInstances), $.functionDef),
    //$.typeclassDef,
    //$.typeclassInstanceDef,
    //$.externModuleImport
  ),

  packageIde: $ => alias($.Identifier, $.packageIde),

  // Section 8.2
  // Variable Assignment
  varAssign: $ => seq($.lValue, '=', $.expression, ';'),
  lValue: $ => choice(
    $.identifier,
    seq($.lValue, '.', $.identifier),
    seq($.lValue, '[', $.expression, ']'),
    seq($.lValue, '[', $.expression, ':', $.expression, ']'),
  ),

  // Section 9
  // Expressions
  expression: $ => choice(
    // $.condExpr,
    $.operatorExpr,
    $.exprPrimary
  ),
  exprPrimary: $ => choice(
    $.identifier,
    $.intLiteral,
    $.realLiteral,
    $.stringLiteral,
    // $.systemFunctionCall,
    seq('(', $.expression, ')')
  ),

  operatorExpr: $ => choice(
    prec(PREC.UNARY, choice('+', '-', '!', '~', '&', '~&', '|', '~|', '^', '^~', '~^')),
    $._binopExpr
  ),

  _binopExpr: $ => choice(
    exprBinop($, PREC.MUL, choice('*', '/', '%')),
    exprBinop($, PREC.ADD, choice('+', '-')),
    exprBinop($, PREC.SHIFT, choice('<<', '>>')),
    exprBinop($, PREC.RELATIONAL, choice('<=', '>=', '<', '>')),
    exprBinop($, PREC.EQUAL, choice('==', '!=')),
    exprBinop($, PREC.AND, '&'),
    exprBinop($, PREC.XOR, '^'),
    exprBinop($, PREC.XNOR, choice('^~', '~^')),
    exprBinop($, PREC.OR, '|'),
    exprBinop($, PREC.LOGICAL_AND, '&&'),
    exprBinop($, PREC.LOGICAL_OR, '||')
  ),

  // TODO
  attributeInstances: $ => "foobar"

  // TODO: add the actual grammar rules
  //source_file: ($) => repeat1(choice($.foo, $.bar)),
  //foo$Stmt: ($) => "foobar",
  //bar$Stmt: ($) => "barfoo",
  //foo: ($) => $["foo$If"],
  //bar: ($) => $["bar$If"],
};

//genericIf(rules, "foo");
//genericIf(rules, "bar");

module.exports = grammar({
  name: "bluespec",
  word: $ => $.identifier,
  rules: rules,
  extras: $ => [/\s/, $.comment],
  inline: $ => [
    $.decNum,
    $.decDigits,
    $.unsizedIntLiteral
  ]
});
