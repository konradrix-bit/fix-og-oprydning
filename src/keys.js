const LABELS = {
  ShiftLeft: "L-SHIFT",
  ShiftRight: "R-SHIFT",
  ControlLeft: "L-CTRL",
  ControlRight: "R-CTRL",
  AltLeft: "L-ALT",
  AltRight: "R-ALT",
  Space: "SPACE",
  Enter: "ENTER",
  Tab: "TAB",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Mouse1: "MOUSE 1",
  Mouse2: "MOUSE 2",
  Mouse3: "MOUSE 3",
  Mouse4: "MOUSE 4",
  Mouse5: "MOUSE 5",
};

export const RESERVED_BINDS = new Set(["Insert", "F2", "Escape"]);

export function formatBind(code) {
  if (!code) return "NONE";
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `NUM ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}

export function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
