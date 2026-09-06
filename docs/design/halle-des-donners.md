# Halle des Donners

Die Halle des Donners übersetzt Ornns monumentale Silhouette in einen hellen,
offenen Raum. Blasser Stein, kühles Metall und ein einzelner Bildbogen geben
dem Dashboard einen anderen Aufbau als den beiden dunkleren Werkstätten.

Es gelten die [gemeinsamen Designregeln](core-design.md).

## Charakter

Weit, klar und standfest. Die Fantasynote entsteht aus dem Bogen, der großen
Serifenschrift und Donnerfürst Ornn im Eislicht. Helle Flächen und dunkler Text
prägen die Arbeitsbereiche. Das Theme eignet sich besonders für helle Räume
und eine Übersicht mit viel freier Fläche.

## Palette

| CSS-Token         | Material         | Wert      | Verwendung                             |
| ----------------- | ---------------- | --------- | -------------------------------------- |
| `--bg`            | Heller Stein     | `#edf1f2` | Seitenhintergrund                      |
| `--surface`       | Kreide           | `#f8fafb` | Runner, Details, Artifacts und Selects |
| `--surface-hover` | Kühler Stein     | `#e3e9ed` | Hover-Flächen                          |
| `--text`          | Schiefer         | `#263b4d` | Haupttext und Überschriften            |
| `--muted`         | Mattes Stahlblau | `#566d7d` | Metadaten und Beschreibungen           |
| `--line`          | Silber           | `#cdd7de` | Zurückhaltende Gliederung              |
| `--accent`        | Eislicht         | `#386a85` | Buttons, Links und Fokus               |
| `--accent-ink`    | Weiß             | `#ffffff` | Text auf gefüllten Buttons             |

„In Arbeit“ verwendet warmes Braun `#9b5328`, „Erfolgreich“ und „Verbunden“
Grün `#367052`. So bleibt der Aktionsakzent vom laufenden Job unterscheidbar.
Die Statuswörter sind auch hier entscheidend, nicht die Farbe allein.

## Aufbau

```text
Marke            Horizontale Navigation            Operator
Einstieg und Aktion                    | Bildbogen
Kennzahlen                             | Runner
Job-Liste                              |
```

Die Navigation verläuft über die gesamte Seite. Der Inhalt ist auf 1240 px
begrenzt und zentriert. Der Einstieg steht frei auf dem Seitenhintergrund,
nicht in einem gemeinsamen Bildkasten. Rechts befindet sich das Porträt im
Bogen. Darunter folgen links Kennzahlen und Jobs, rechts der Runner.

Die vertikale Bildkante und die Runner-Karte bilden eine zweite, ruhige Achse.
Die Liste bleibt breit und erhält keine zusätzliche äußere Kartenumrandung.

## Bild und Schrift

Asset: `/images/ornn/thunder.jpg`. Der Ausschnitt betont Kopf, Hörner und
Rüstung. Die Oberkante ist mit 160 px abgerundet, die Unterkante fast gerade.
Die Bildbeschriftung liegt auf einer deckenden dunkelblauen Fläche `#142635`,
damit Blitze ihre Lesbarkeit nicht beeinträchtigen.

Cormorant Garamond trägt den Einstieg und die Kennzahlen. DM Sans trägt
Navigation und Arbeitsinhalte. Die Überschrift „Große Ideen. Solides Handwerk.“
steht großzügig mit bis zu 78 px neben dem Bild; sie überlagert es nicht.

## Formen und Interaktion

Überwiegend gerade Kanten, schmale Linien und kaum Schatten. Der Bildbogen ist
die charakteristische Rundung. Der Runner besitzt oben eine 3 px breite blaue
Linie. Das aktive Navigationsziel erhält eine Unterstreichung; der primäre
Button ist ein schlichtes blaues Rechteck. Kreise bleiben kleinen Job-Symbolen
und dem Operator vorbehalten.

## Mobile und Grenzen

Bis 850 px bekommt die Navigation eine eigene Zeile unter Marke und Operator.
Bis 600 px steht ein flacherer Bildbogen über dem Einstieg, anschließend folgen
Kennzahlen, Job-Liste und Runner. Die große Überschrift reduziert sich auf 48 px.

Vermeiden: goldene Ornamente, Pergamenttöne, flächige Blauverläufe und zusätzliche
runde Karten. Das Eislicht kommt aus dem Artwork und wenigen blauen Akzenten.
