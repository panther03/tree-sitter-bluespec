function genericBeginEndStmt(rules, ctxt) {
  rules[`${ctxt}BeginEndStmt`] = ($) => seq(
    "begin", optional(seq(':', $.identifier)),
    repeat($[`${ctxt}Stmt`]),
    'end', optional(seq(':', $.identifier)))
}

function genericIf(rules, ctxt) {
  rules[`${ctxt}If`] = ($) => prec.right(seq("if", '(', $.condPredicate, ')', $[`${ctxt}Stmt`], optional(seq("else", $[`${ctxt}Stmt`]))))
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
  CALL: 19,
  WRITE: 18,
  DECLARE: 17,
  ASSIGN: 16,
  LVALUE: 15,
  AVSTMT: 14,
  TEXPR: 13,
  MCALL: 12,
  BSELECT: 11,
  TYPEIDE: 10

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
  
  Identifier: ($) => /[A-Z_][a-zA-Z0-9_$]*/,
  identifier: ($) => /[a-z_][a-zA-Z0-9_$]*/,

  // Section 2.3
  // Integer Literals
  intLiteral: ($) => prec.left(choice("'0", "'1",
    $.sizedIntLiteral, $.unsizedIntLiteral)),
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
    $.moduleDef,
    $.interfaceDecl,
    //$.typeDef,
    $.varDecl,
    $.varAssign,
    $.functionDef,
    //$.typeclassDef,
    //$.typeclassInstanceDef,
    //$.externModuleImport
  ),

  packageIde: $ => alias($.Identifier, $.packageIde),

  // Section 4
  // Types
  type: $ => choice($.typePrimary,
    seq($.typePrimary, '(', $.type, repeat(seq(',', $.type)),')')),
  
  typePrimary: $ => choice(
    seq($.typeIde, optional(seq('#', '(', $.type, repeat(seq(',', $.type)), ')'))),
    $.typeNat,
    seq('bit','[', $.typeNat, ':', $.typeNat, ']')
  ),

  typeIde: $ => prec(PREC.TYPEIDE, alias($.Identifier, $.typeIde)),
  typeNat: $ => $.decDigits,

  // Section 5.2
  // Interface declaration

  interfaceDecl: $ => seq(
    optional($.attributeInstances),
    'interface', $.typeDefType, ';',
    repeat( $.interfaceMemberDecl ),
    'endinterface', optional(seq(':', $.typeIde))
  ),
  typeDefType: $ => seq($.typeIde, optional($.typeFormals)),
  typeFormals: $ => seq('#', '(', $.typeFormal, repeat(seq(',', $.typeFormal))),
  typeFormal: $ => seq(choice('numeric', 'string'), 'type', $.typeIde),
  interfaceMemberDecl: $ => choice($.methodProto, $.subinterfaceDecl),
  methodProto: $ => seq(optional($.attributeInstances), 'method', $.type, $.identifier, '(', optional($.methodProtoFormals), ')'),
  methodProtoFormals: $ => seq($.methodProtoFormal, repeat(seq(',', $.methodProtoFormal))),
  methodProtoFormal: $ => seq(optional($.attributeInstances), $.type, $.identifier),

  // Section 5.2.1
  // Subinterfaces
  subinterfaceDecl: $ => seq(optional($.attributeInstances), 'interface', $.typeDefType, ';'),

  // Section 5.3
  // Module definition

  moduleDef: $ => seq(optional($.attributeInstances), $.moduleProto, repeat($.moduleStmt), 'endmodule', optional(seq(':', $.identifier))),
  // TODO provisos
  moduleProto: $ => seq('module', optional(seq('[', $.type, ']')), $.identifier),
  moduleFormalParams: $ => seq('#', '(', $.moduleFormalParam, repeat(seq(',', $.moduleFormalParam))),
  moduleFormalParam: $ => seq(optional($.attributeInstances), optional('parameter'), $.type, $.identifier),
  moduleFormalArgs: $ => choice(seq(optional($.attributeInstances), $.type),
    seq(optional($.attributeInstances), $.type, $.identifier, repeat(seq(',', optional($.attributeInstances), $.type)))), 

  // Section 5.4.1
  // Short form instantiation
  moduleInst: $ => seq(optional($.attributeInstances), 'type', $.identifier, '<-', $.moduleApp),
  moduleApp: $ => seq($.identifier, '(', optional(seq($.moduleActualParamArg, repeat(seq(',', $.moduleActualParamArg)))), ')'),
  moduleActualParamArg: $ => choice($.expression, seq('clocked_by', $.expression), seq('reset_by', $.expression)),

  // Section 5.4.2
  // Long form instantiation
  // TODO

  // Section 5.5 
  // Interface definition
  moduleStmt: $ => choice(
    $.methodDef,
    $.subinterfaceDef,
    $.returnStmt,
    $.rule
  ),
  methodDef: $ => seq(
      'method', optional($.type), $.identifier, '(', $.methodFormals, ')', optional($.implicitCond), ';',
      choice(
        $.actionBlock,
        $.actionValueBlock,
        repeat($.functionBodyStmt)
      ),
  'endmethod', optional(seq(':', $.identifier))),
  methodFormals: $ => seq($.methodFormal, repeat(seq(',', $.methodFormal))),
  methodFormal: $ => seq(optional($.type), $.identifier),
  implicitCond: $ => seq('if', '(', $.condPredicate, ')'),
  condPredicate: $ => seq($.exprOrCondPattern, repeat(prec.left(seq('&&&', $.exprOrCondPattern)))),
  exprOrCondPattern: $ => choice(
    $.expression,
    // TODO
    //seq($.expression, 'matches', $.pattern)
  ),
  
  // Section 5.5.1
  // Shorthands for Action and ActionValue method definitions
  // TODO

  // Section 5.5.2
  // Definition of subinterfaces
  subinterfaceDef: $ => seq('interface', $.Identifier, $.identifier, ';', repeat($.interfaceStmt), 'endinterface', optional(seq(':', $.identifier))),

  // Section 5.5.3
  // Definition of methods and subinterfaces by assignment
  // TODO

  // Section 5.6
  // Rules in module definitions
  rule: $ => seq(optional($.attributeInstances), 'rule', $.identifier, optional($.ruleCond), ';', repeat($.actionStmt), 'endrule', optional(seq(':', $.identifier))),
  ruleCond: $ => seq('(', $.condPredicate, ')'),


  // Section 9.1
  // Variable and array declaration and initialization
  varDecl: $ => choice(
    seq($.type, $.varInit, repeat(seq(',', $.varInit)), ';'),
    seq('let', $.identifier, '=', $.expression, ';')
  ),
  varInit: $ => seq($.identifier, optional($.arrayDims), optional(seq('=', $.expression))),
  arrayDims: $ => seq('[', $.expression, ']', repeat(seq('[', $.expression, ']'))),

  // Section 9.2
  // Variable Assignment
  varAssign: $ => seq($.lValue, '=', $.expression, ';'),
  lValue: $ => prec(PREC.LVALUE, choice(
    $.identifier,
    seq($.lValue, '.', $.identifier),
    seq($.lValue, '[', $.expression, ']'),
    seq($.lValue, '[', $.expression, ':', $.expression, ']'),
  )),
  
  // Section 9.4
  // Register reads and writes
  regWrite: $ => prec(PREC.WRITE, choice(
    seq($.lValue, '<=', $.expression),
    seq($.lValue, $.arrayIndexes, '<=', $.expression),
    seq('(', $.expression, ')', '<=', $.expression),
    seq($.lValue, '[', $.expression, ':', $.expression, ']', '<=', $.expression),
    seq($.lValue, '.', $.identifier, '<=', $.expression),
  )),
  arrayIndexes: $ => seq('[', $.expression, ']', repeat(seq('[', $.expression, ']'))),

  // TODO: case statements
  // TODO: while loop
  // TODO: for loop

  // Section 9.8
  // Function definitions
  functionDef: $ => seq(optional($.attributeInstances), $.functionProto, choice(
    $.actionBlock,
    $.actionValueBlock,
    repeat($.functionBodyStmt)
  ), 'endfunction', optional(seq(':', $.identifier))),
  functionProto: $ => seq('function', $.type, $.identifier, '(', optional($.functionFormals), ')', optional($.provisos), ';'),
  functionFormals: $ => seq($.functionFormal, repeat(seq(',', $.functionFormal))),
  functionFormal: $ => seq($.type, $.identifier),
  functionBodyStmt: $ => choice(
    $.returnStmt,
    $.varDecl,
    $.varAssign,
    $.functionDef,
    $.moduleDef,
    $.functionBodyBeginEndStmt,
    $.functionBodyIf,
    //$.functionBodyCase,
    //$.functionBodyFor,
    //$.functionBodyWhile,
  ),

  // Section 9.8.1
  // Definition of functions by assignment
  // TODO

  // Section 10
  // Expressions
  expression: $ => choice(
    $.condExpr,
    $.operatorExpr,
    $.exprPrimary
  ),
  exprPrimary: $ => prec(-1,choice(
    $.identifier,
    // TODO: the grammar doesn't specify this, but this is necessary for enum values (True, False)?
    $.Identifier, 
    $.intLiteral,
    $.realLiteral,
    $.stringLiteral,
    $.systemFunctionCall,
    seq('(', $.expression, ')'),
    // 10.1
    '?',
    // 10.4
    $.bitConcat,
    $.bitSelect,
    // 10.5
    $.beginEndExpr,
    // 10.6
    $.actionBlock,
    // 10.7
    $.actionValueBlock,
    // 10.8
    $.functionCall,
    // 10.9
    $.methodCall,
    // 10.11.1
    $.structExpr,
    // 10.11.2
    seq($.exprPrimary, '.', $.identifier),
    // 10.11.3
    $.taggedUnionExpr,
    // 10.12
    $.interfaceExpr,
    // 4.2.1
    seq(choice('valueOf', 'valueof'), '(', $.type, ')')
  )),

  // Section 10.1
  // Don't-care expressions
  // '?' rule for exprPrimary

  // Section 10.2
  // Conditonal expresssions
  condExpr: $ => prec(PREC.CONDITIONAL, seq($.condPredicate, '?', $.expression, ':', $.expression)),

  // Section 10.3
  // Unary and binary operators

  operatorExpr: $ => choice(
    prec(PREC.UNARY, seq(choice('+', '-', '!', '~', '&', '~&', '|', '~|', '^', '^~', '~^'), $.expression)),
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

  // 10.4 Bit concatenation and selection
  bitConcat: $ => seq('{', $.expression, repeat(seq(',', $.expression)), '}'),
  bitSelect: $ => prec(PREC.BSELECT, seq($.exprPrimary, '[', $.expression, optional(seq(':', $.expression)), ']')),

  // 10.5 Begin-end expressions
  
  beginEndExpr: $ => prec.right(seq('begin', optional(seq(':', $.identifier)), repeat($.expressionStmt), $.expression, 'end', optional(seq(':', $.identifier)))),

  expressionStmt: $ => choice($.varDecl,
    $.varAssign,
    $.functionDef,
    $.moduleDef,
    $.expressionBeginEndStmt,
    $.expressionIf,
    //$.expressionCase,
    //$.expressionFor,
    //$.expressionWhile
  ),

  // 10.6 Actions and action blocks

  actionBlock: $ => prec.right(seq('action', optional(seq(':', $.identifier)), repeat($.actionStmt), $.expression, 'endaction', optional(seq(':', $.identifier)))),
  actionStmt: $ => prec(3,choice($.regWrite,
    $.varDo, $.varDeclDo,
    $.functionCall,
    $.systemTaskStmt,
    seq('(', $.expression, ')'),
    $.actionBlock,
    $.varDecl,
    $.varAssign,
    $.functionDef,
    $.moduleDef,
    $.actionBeginEndStmt,
    $.actionIf,
    //$.actionCase,
    //$.actionFor,
    //$.actionWhile
  )),

  // 10.7 Actionvalue blocks
  actionValueBlock: $ => prec.right(seq('actionvalue', optional(seq(':', $.identifier)), repeat($.actionValueStmt), $.expression, 'endactionvalue', optional(seq(':', $.identifier)))),
  actionValueStmt: $ => prec(PREC.AVSTMT, choice($.regWrite,
    $.varDo, $.varDeclDo,
    $.functionCall,
    $.systemTaskStmt,
    seq('(', $.expression, ')'),
    $.returnStmt,
    $.varDecl,
    $.varAssign,
    $.functionDef,
    $.moduleDef,
    $.actionValueBeginEndStmt,
    $.actionValueIf,
    //$.actionValueCase,
    //$.actionValueFor,
    //$.actionValueWhile
  )),

  varDeclDo: $ => seq($.type, $.identifier, '<-', $.expression, ';'),
  varDo: $ => seq($.identifier, '<-', $.expression, ';'),


  // 10.8 Function calls
  // TODO: make parentheses optional
  functionCall: $ => prec(PREC.CALL,prec.left(seq($.exprPrimary, seq('(', optional(seq($.expression, repeat(seq(',', $.expression)))), ')')))),

  // 10.9 Method calls
  methodCall: $ => prec(PREC.MCALL, prec.left(seq($.exprPrimary, '.',  $.identifier, optional(seq('(', optional(seq($.expression, repeat(seq(',', $.expression)))), ')'))))),

  // 10.11.1 Struct expressions
  structExpr: $ => seq($.Identifier, '{', $.memberBind, repeat(seq(',', $.memberBind)), '}'),
  memberBind: $ => seq($.identifier, ':', $.expression),

  // 10.11.3: Tagged union expressions
  taggedUnionExpr: $ => prec(PREC.TEXPR, choice(
    seq("tagged", $.Identifier, '{', $.memberBind, repeat(seq(',', $.memberBind)), '}'),
    seq("tagged", $.Identifier, $.exprPrimary)
  )),

  // 10.12: Interface expressions
  returnStmt: $ => seq("return", $.expression, ';'),
  interfaceExpr: $ => prec.right(seq('interface', $.Identifier, ';', repeat($.interfaceStmt), 'endinterface', optional(seq(':', $.Identifier)))),
  interfaceStmt: $ => choice($.methodDef, $.subinterfaceDef, $.expressionStmt),

  // 10.13: Rule expressions
  // TODO
  
  // STUBS
  attributeInstances: $ => "foo",
  systemFunctionCall: $ => "bing",
  systemTaskStmt: $ => "sjhsakjhda",
  provisos: $ => "bar"
};

ctxts = ['action', 'actionValue', 'expression', 'functionBody']
ctxts.forEach(ctxt => {
  genericBeginEndStmt(rules, ctxt);
  genericIf(rules, ctxt);
});

module.exports = grammar({
  name: "bluespec",
  word: $ => $.identifier,
  rules: rules,
  extras: $ => [/\s/, $.comment],
  inline: $ => [
    $.decNum,
    $.decDigits,
    $.unsizedIntLiteral,
    $.expression
  ],
  conflicts: $ => [
    [$.intLiteral,$.typeNat],
    [$.intLiteral,$.bitWidth],
    //[$.actionStmt, $.exprPrimary],
    //[$.actionValueStmt, $.exprPrimary],
    [$.actionBeginEndStmt,$.expressionBeginEndStmt],
    [$.actionValueBeginEndStmt,$.expressionBeginEndStmt],
    [$.condPredicate, $.condPredicate],
    //[$.exprPrimary, $.methodCall],
    //[$.exprPrimary, $.actionStmt],
    //[$.lValue, $.exprPrimary]
  ]
});
