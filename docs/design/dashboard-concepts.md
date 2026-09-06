# Dashboard-Designs

Die drei Themes teilen Inhalte und Bedienelemente, unterscheiden sich aber in
Raumaufteilung, Materialfarben und Bildkomposition. Das Menü „Design ansehen“
unter `/dashboard/examples` wechselt zwischen ihnen. `/dashboard` bleibt ein
einfacher Platzhalter im aufgehellten Vulkanschmiede-Theme. Beide Routen sind
durch dieselbe Dashboard session geschützt.

| Theme                                     | Charakter                                    | Aufbau                                                 | URL                                |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| [Vulkanschmiede](vulkanschmiede.md)       | Mitteldunkler Vulkanstein, Kupfer und Glut   | Seitennavigation, breites Bildband, Arbeitsliste       | `/dashboard/examples?design=forge` |
| [Halle des Donners](halle-des-donners.md) | Heller Stein, Silber und Eislicht            | Horizontale Navigation, freier Einstieg und Bildbogen  | `/dashboard/examples?design=hall`  |
| [Ahnenholz](ahnenholz.md)                 | Mitteldunkles Moosgrün, Laub und Blütenlicht | Schmale Navigation, hohes Bildfenster neben der Arbeit | `/dashboard/examples?design=grove` |

[Core-Design](core-design.md) definiert die gemeinsamen UI-Konzepte, Typografie,
Abstände, Lesbarkeit, Responsive-Regeln, Domain-Begriffe und Bildquellen.
Die Theme-Dateien definieren jeweils die Palette, ihre Verwendung, Formen,
Bildführung und Grenzen für den weiteren Ausbau.

Alle drei Ansichten verwenden dieselben markierten Beispieldaten. Vulkanschmiede
und Ahnenholz sind bewusst aufgehellt, damit Arbeitsflächen und Metadaten auch
auf Monitoren mit schwacher Schattendarstellung erkennbar bleiben.
