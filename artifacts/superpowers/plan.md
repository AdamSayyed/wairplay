## Goal
Show an image preview when the user long-presses (holds) on the file info box after selecting an image file.

## Assumptions
- The preview should trigger via touch or mouse long-press (e.g., holding for ~500ms).
- We can use `URL.createObjectURL()` to quickly render the selected file client-side before upload.
- If multiple files are selected, we will look for the first valid image to preview, or do nothing if none are images.
- A full-screen overlay will be used to display the image.

## Plan
1. **Update HTML for Preview Overlay**
   - **Files:** `public/send.html`
   - **Change:** Add an `#imagePreviewOverlay` element (hidden by default) with an `<img>` tag and a close button. Style it to be a full-screen, high z-index overlay with a semi-transparent dark background.
   - **Verify:** Ensure `send.html` parses correctly and the overlay is hidden by default.

2. **Add Long-Press and Preview Logic to JS**
   - **Files:** `public/js/sender.js`
   - **Change:** 
     - Add a `contextmenu` listener to `fileInfoSection` to `preventDefault()` (prevents default mobile menus on long press).
     - Add `touchstart` / `mousedown` listeners to start a ~500ms timer.
     - Add `touchend` / `mouseup` / `mouseleave` listeners to clear the timer if released early.
     - If the timer fires, find the first image in `selectedFiles`, generate a `URL.createObjectURL()`, and display the overlay.
     - Add click handlers to close the overlay and revoke the object URL.
   - **Verify:** Open the sender UI, select an image, long-press the file box, and verify the image preview appears and can be closed.

## Risks & mitigations
- **Risk:** The default context menu still appears on mobile devices.
  - **Mitigation:** Adding `oncontextmenu="return false;"` or `e.preventDefault()` to the box, and using `user-select: none;` / `-webkit-touch-callout: none;` via CSS.
- **Risk:** Memory leak from object URLs.
  - **Mitigation:** Explicitly call `URL.revokeObjectURL()` when closing the preview overlay or selecting new files.

## Rollback plan
Revert `public/send.html` and `public/js/sender.js` to their previous states.
