// The garden's icons: line drawings on a 24 px grid in the interface's ink
// (currentColor), round caps, a slightly hand-drawn hand. Trusted markup.

const icon = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  door: icon('<path d="M6.8 20V4.6h8.4V20"/><path d="M4.4 20h15.2"/><circle cx="12.9" cy="12.4" r=".8" fill="currentColor"/><path d="M17.8 9.4 20.2 12l-2.4 2.6"/>'),
  house: icon('<path d="M3.4 11.2 12 4.6l8.6 6.6"/><path d="M5.6 9.8v9.7h12.8V9.8"/><path d="M10.4 19.5v-4.6h3.2v4.6"/><path d="M15.8 7.2V4.4h2v4.3"/><path d="M7.6 12.6h2.2v2H7.6z"/>'),
  find: icon(
    '<circle cx="12" cy="12" r="7.6"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2"/><path d="M9.2 14.8v-3.4a2.8 2.8 0 0 1 5.6 0v3.4a1 1 0 0 1-1 1h-3.6a1 1 0 0 1-1-1Z"/><circle cx="11" cy="12" r=".55" fill="currentColor"/><circle cx="13" cy="12" r=".55" fill="currentColor"/>',
  ),
  basket: icon('<path d="M7.2 10.2a4.8 4.8 0 0 1 9.6 0"/><path d="M3.6 10.2h16.8l-1.7 8.4a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6Z"/><path d="M8.6 13v4.6M12 13v4.6M15.4 13v4.6M4.6 13.6h14.8"/>'),
  pin: icon('<circle cx="12" cy="8.4" r="4.4"/><path d="M12 12.8v8"/><path d="M10.4 7.2a1.6 1.6 0 0 1 1.6-1.4"/>'),
  heart: icon('<path d="M12 19.6s-7.4-4.4-7.4-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.4 2.3c0 5.3-7.4 9.7-7.4 9.7Z"/>'),
  heartFilled: icon('<path d="M12 19.6s-7.4-4.4-7.4-9.7A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.4 2.3c0 5.3-7.4 9.7-7.4 9.7Z" fill="currentColor"/>'),
  left: icon('<path d="M14.6 5.6 8.2 12l6.4 6.4"/>'),
  right: icon('<path d="m9.4 5.6 6.4 6.4-6.4 6.4"/>'),
  close: icon('<path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4"/>'),
  open: icon('<path d="M9.4 5.6h9v9"/><path d="M18.2 5.8 6 18"/>'),
  play: icon('<path d="M8.6 6.4v11.2l9.2-5.6Z" fill="currentColor" stroke-width="1.2"/>'),
  album: icon('<rect x="4.4" y="6.6" width="13.2" height="11" rx="1.4"/><path d="M7.4 4.4h11.2a1.4 1.4 0 0 1 1.4 1.4v9.2"/><path d="m6.6 15.4 3.4-3.4 2.6 2.6 1.6-1.6 1.8 1.8"/>'),
  globe: icon('<circle cx="12" cy="12" r="5.6"/><path d="M3.2 15.6c2.4 1.6 9.6-.6 14.6-5.2 2.4-2.2 3.2-3.8 2.6-4.4-.8-.8-3.6.4-6 2"/>'),
  envelope: icon('<rect x="3.6" y="6.2" width="16.8" height="11.6" rx="1.6"/><path d="m4.2 7 7.8 6.2L19.8 7"/>'),
  lock: icon('<rect x="5.6" y="10.6" width="12.8" height="9" rx="2"/><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6"/>'),
  share: icon('<circle cx="12" cy="12" r="3"/><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/>'),
  camera: icon('<rect x="4" y="4" width="16" height="16" rx="4.6"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".7" fill="currentColor"/>'),
  people: icon('<circle cx="9" cy="9" r="3"/><path d="M3.8 18.6a5.2 5.2 0 0 1 10.4 0"/><circle cx="16.4" cy="9.6" r="2.4"/><path d="M15.2 13.6a4.4 4.4 0 0 1 5 4.6"/>'),
  sprout: icon('<path d="M12 20v-7"/><path d="M12 13c0-3.6-2.6-5.6-6.4-5.6 0 3.6 2.6 5.6 6.4 5.6Z"/><path d="M12 11.4c0-3 2.2-5 5.6-5 0 3-2.2 5-5.6 5Z"/>'),
  flip: icon('<path d="M4.6 9.2a7.6 7.6 0 0 1 13.6-2.4"/><path d="M18.6 3.8v3.4h-3.4"/><path d="M19.4 14.8a7.6 7.6 0 0 1-13.6 2.4"/><path d="M5.4 20.2v-3.4h3.4"/>'),
  stack: icon('<rect x="5" y="8" width="14" height="10" rx="1.4"/><path d="M7 5.4h10M9 3h6"/>'),
} as const;
