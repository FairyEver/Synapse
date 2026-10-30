# Playing card artwork

52 classic SVG faces from [letele/playing-cards](https://github.com/letele/playing-cards), commit `865a78eb940c1232e4b21523577c8fca52f694fe`. Original artwork: [Adrian Kennard](https://www.me.uk/cards/).

License: CC0 1.0 Universal; complete upstream text is in `LICENSE`. No package dependency or external image service is used.

Synapse adaptations: enlarge both corner rank symbols from 32 to 64 units, suit symbols from 26.769 to 40 units; move them to (-112, -156) and (-101, -88), scale central artwork to 70% for separation (Ace central suit enlarged to 140 units), and use crimson/dark ink with a muted blue for court outlines. Ace of Spades uses a plain central suit instead of the decorative wordmark. Original 240 × 336 viewBox and 5% corner radius are preserved. These changes improve recognition at 24–70 px card widths without relying on OS fonts. Files are renamed from upstream suit/rank names (e.g. `H-10.svg`) to Synapse card codes (`Th.svg`). Jokers and upstream backs are not included. `Card.tsx` remains the single rendering component for hall previews, tables and records, including its existing flip and back rendering.
