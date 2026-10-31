# Playing card artwork

52 local SVG faces using suit outlines from [letele/playing-cards](https://github.com/letele/playing-cards), commit `865a78eb940c1232e4b21523577c8fca52f694fe`. Original suit artwork: [Adrian Kennard](https://www.me.uk/cards/).

Suit artwork license: CC0 1.0 Universal; complete upstream text is in `LICENSE`. No new package dependency or external image service is used.

The approved large vertical design shows exactly one rank above one suit, without corner indices, pip patterns or court illustrations. Rank outlines come from the project's bundled Geist Variable font at weight 700; its SIL Open Font License is retained in `GEIST-LICENSE`. All glyphs are paths, so rendering does not depend on installed fonts or external resources.

Each face retains the 240 × 336 canvas (`viewBox="-120 -168 240 336"`) and 12-unit corner radius. The centered rank occupies y=-144…-16 (128 units); the suit occupies y=4…144 (140 units), leaving a 20-unit gap and 24 units of padding at both the top and bottom. The suit is normalized to its actual outline bounds rather than its source symbol viewport. Hearts and diamonds retain crimson `#bd263a`; clubs and spades retain dark ink `#171b21`, on a white face, independent of the application theme. `T` remains the protocol code and is drawn as `10`.

Files use Synapse card codes (`Th.svg`). Jokers and upstream backs are not included. `Card.tsx` remains the single rendering component for hall previews, tables and records, including its existing flip, hidden-card protection and back rendering.
