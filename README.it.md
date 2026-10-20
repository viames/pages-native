# Pages Native

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/viames/pages-native)

Plugin Codex e server MCP per documenti **Apple Pages nativi**, di **Viames Marino**, licenza **MIT**.

**Versione 0.5.0.** Superati 76 controlli nativi su un Mac con Pages 14.5 e macOS 27.0.1, oltre a 70 test portabili. La compatibilità con altre versioni non è ancora verificata.

Il progetto include 36 strumenti: documenti, modelli nativi e personalizzati, testo con anteprima e controllo revisione, segnaposto già presenti, tabelle e formule, oggetti, esportazioni esplicite, backup e anteprime PDF/PNG. Il file di lavoro rimane `.pages`; non vengono usati conversioni Word, Accessibilità, appunti o formati privati Apple. Pages 14.5 permette di leggere i tag dei segnaposto, ma rifiuta di modificarli tramite la propria API di scripting.

Novità 0.5: generazione in serie fino a 10 documenti, storico delle ricette con copie dei modelli, confronto strutturato, riuso e ripristino delle versioni precedenti. [Guida a serie e storico](docs/BATCH-AND-HISTORY.md).

Novità 0.4: campi collegati a celle native con valori tipizzati, formati compatibili e formule; libreria locale di ricette con definizioni/default, riferimenti relativi ai modelli e controllo revisioni. [Guida ed esempi](docs/RECIPES.md).

Novità 0.3: ricerca strutturata con contesto e riferimenti nativi a testo/celle; composizione guidata da modelli `.pages` salvati, con campi obbligatori, valori predefiniti e anteprima/applicazione su una nuova copia. [Ricette ed esempi](docs/SEARCH-AND-TEMPLATES.md).

Le funzioni editoriali che l'API non espone restano escluse: stili di paragrafo completi, commenti, revisioni, collegamenti, intestazioni/piè di pagina, controllo completo dell'impaginazione e serie/tipo/titolo dei grafici. Cambiare font, dimensioni e colori non assegna uno stile di paragrafo; la conservazione degli stili semantici durante la compilazione dei modelli non è ancora certificata.

Dalla versione 0.2 le modifiche a tabelle, celle, formattazione, oggetti e pagine affiancate producono prima un’anteprima. Per applicarle serve la stessa richiesta con `mode:"apply"` ed `expected_revision`. Il worker nativo ricontrolla lo stato esposto dall’API prima di scrivere.

`pages_compatibility` confronta le versioni locali con le prove registrate; [report e matrice](docs/COMPATIBILITY.md) consentono di raccogliere verifiche su altri Mac senza dichiararli già collaudati.

Richiede macOS con sessione utente, Apple Pages, Node.js 22+ e il permesso Automazione per l'app ospitante. [Documentazione tecnica](README.md).

Per installarlo in Codex: `codex plugin marketplace add viames/pages-native`, poi `codex plugin add pages-native@viames-pages`. Avvia una nuova chat locale dopo l'installazione.
