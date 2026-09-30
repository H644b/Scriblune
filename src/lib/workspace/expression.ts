// A small arithmetic parser. No eval, Function, property access, assignments, or JavaScript.
type Node =
  | { kind: "number"; value: number }
  | { kind: "x" }
  | { kind: "unary"; op: string; right: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; arg: Node };
const functions: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
};
export function parseExpression(expression: string): (x: number) => number {
  if (expression.length > 120) throw new Error("Expression too long.");
  const tokens =
    expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[a-z]+|[()+\-*/^]/g) || [];
  if (tokens.join("") !== expression.replace(/\s/g, "") || tokens.length > 100)
    throw new Error(
      "Use only x, numbers, arithmetic, and supported functions.",
    );
  let pos = 0;
  function parse(min = 0, depth = 0): Node {
    if (depth > 24) throw new Error("Expression too complex.");
    const token = tokens[pos++];
    let left: Node;
    if (token === "+" || token === "-")
      left = { kind: "unary", op: token, right: parse(3, depth + 1) };
    else if (token === "(") {
      left = parse(0, depth + 1);
      if (tokens[pos++] !== ")")
        throw new Error("Missing closing parenthesis.");
    } else if (token === "x") left = { kind: "x" };
    else if (token === "pi") left = { kind: "number", value: Math.PI };
    else if (token === "e") left = { kind: "number", value: Math.E };
    else if (Object.hasOwn(functions, token)) {
      if (tokens[pos++] !== "(")
        throw new Error("A function needs parentheses.");
      const arg = parse(0, depth + 1);
      if (tokens[pos++] !== ")")
        throw new Error("Missing closing parenthesis.");
      left = { kind: "call", name: token, arg };
    } else if (token && /^\d|^\./.test(token))
      left = { kind: "number", value: Number(token) };
    else throw new Error("Invalid expression.");
    while (pos < tokens.length) {
      const op = tokens[pos];
      const prec =
        op === "+" || op === "-"
          ? 1
          : op === "*" || op === "/"
            ? 2
            : op === "^"
              ? 4
              : 0;
      if (!prec || prec < min) break;
      pos++;
      left = {
        kind: "binary",
        op,
        left,
        right: parse(prec + (op === "^" ? 0 : 1), depth + 1),
      };
    }
    return left;
  }
  const ast = parse();
  if (pos !== tokens.length) throw new Error("Unexpected expression token.");
  function run(n: Node, x: number): number {
    if (n.kind === "number") return n.value;
    if (n.kind === "x") return x;
    if (n.kind === "unary") return (n.op === "-" ? -1 : 1) * run(n.right, x);
    if (n.kind === "call") return functions[n.name](run(n.arg, x));
    const a = run(n.left, x),
      b = run(n.right, x);
    return n.op === "+"
      ? a + b
      : n.op === "-"
        ? a - b
        : n.op === "*"
          ? a * b
          : n.op === "/"
            ? a / b
            : a ** b;
  }
  return (x: number) => run(ast, x);
}
export function plotPoints(
  expression: string,
  box: { width: number; height: number },
  range: { xMin: number; xMax: number; yMin: number; yMax: number },
) {
  if (range.xMin >= range.xMax || range.yMin >= range.yMax)
    throw new Error("Graph ranges must increase.");
  const f = parseExpression(expression);
  const points = [];
  for (let i = 0; i <= 400; i++) {
    const x = range.xMin + ((range.xMax - range.xMin) * i) / 400;
    const y = f(x);
    if (!Number.isFinite(y) || y < range.yMin || y > range.yMax) {
      if (points.length)
        throw new Error(
          "Choose a graph range containing a continuous visible curve.",
        );
      continue;
    }
    points.push({
      x: (i / 400) * box.width,
      y: ((range.yMax - y) / (range.yMax - range.yMin)) * box.height,
    });
  }
  if (points.length < 2)
    throw new Error("The curve is not visible in this range.");
  return points;
}
