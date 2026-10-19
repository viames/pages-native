# Pages Native

Plugin Codex e server MCP per documenti **Apple Pages nativi**, di **Viames Marino**, licenza **MIT**.

Versione preliminare 0.1.0: le prove native sono state superate su un Mac con Pages 14.5 e macOS 27.0.1. La compatibilità con altre versioni non è ancora verificata.

Il progetto include 28 strumenti: documenti, modelli nativi e personalizzati, testo con anteprima e controllo revisione, segnaposto già presenti, tabelle e formule, oggetti, esportazioni esplicite, backup e anteprime PDF/PNG. Il file di lavoro rimane `.pages`; non vengono usati conversioni Word, Accessibilità, appunti o formati privati Apple. Pages 14.5 permette di leggere i tag dei segnaposto, ma rifiuta di modificarli tramite la propria API di scripting.

Le funzioni editoriali che l'API non espone restano escluse: stili di paragrafo completi, commenti, revisioni, collegamenti, intestazioni/piè di pagina, controllo completo dell'impaginazione e serie/tipo/titolo dei grafici.

Richiede macOS con sessione utente, Apple Pages, Node.js 22+ e il permesso Automazione per l'app ospitante. [Documentazione tecnica](README.md).

Per installarlo in Codex: `codex plugin marketplace add viames/pages-native`, poi `codex plugin add pages-native@viames-pages`. Avvia una nuova chat locale dopo l'installazione.
