// Issue #7 Wave 2C — Library is now a folder of components. This file
// stays as a thin re-export so existing imports (`./components/Library`)
// continue to resolve. New imports should target `./components/Library/Library`
// or a specific sibling (`./components/Library/Tree`, etc.) directly.
export { Library, _focusExistingTile } from "./Library/Library";
