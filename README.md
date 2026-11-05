# LeadFinder Neti Labs

Extension Chrome (Manifest V3) de prospection : trouve des entreprises **sans site**, avec un **site obsolète** ou un **site à améliorer**, récupère leurs coordonnées publiques, audite leur site et les classe par score commercial /100.

## Installation dans Chrome

0. Sur cette page GitHub : bouton vert **Code → Download ZIP**, puis décompressez le fichier (clic droit → Extraire tout).
1. Ouvrez `chrome://extensions`.
2. Activez **Mode développeur** (en haut à droite).
3. Cliquez **Charger l'extension non empaquetée** et choisissez le dossier décompressé (celui qui contient `manifest.json`).
4. Épinglez l'icône LeadFinder (pièce de puzzle → épingle). Cliquez dessus → **Ouvrir le tableau de bord**.

Après une modification du code : bouton ↻ sur la carte de l'extension dans `chrome://extensions`, puis rechargez l'onglet LeadFinder.

## 100 % gratuit

Aucun service payant, aucune carte bancaire. Les seuls services externes sont :

| Source | Clé | Apporte |
|---|---|---|
| **OpenStreetMap** (Nominatim + Overpass) | aucune | entreprises, adresse, et quand ils sont renseignés : téléphone, e-mail, site, Facebook, Instagram |
| **Site de l'entreprise** | aucune | e-mail, téléphone, réseaux sociaux publiés sur l'accueil et la page contact (pendant l'audit) |
| **Google PageSpeed Insights** | gratuite, sans facturation | performances, Core Web Vitals, accessibilité, SEO technique |

Google Maps n'est **pas** scrapé (interdit par les conditions de Google). Le bouton « Maps » ouvre simplement une recherche Google Maps sur le nom et l'adresse.

Limite de la gratuité : OpenStreetMap est moins complet que Google. Beaucoup de commerces n'y ont ni téléphone ni site renseigné. « Sans site » veut donc dire « site non renseigné dans OSM ». La fiche l'indique (« À confirmer ») : vérifiez d'un coup d'œil sur Google avant de contacter. Les notes et nombres d'avis Google ne sont pas disponibles.

## Clé API (gratuite)

### Google PageSpeed Insights — pour mesurer performances et Core Web Vitals
1. Allez sur https://console.cloud.google.com/ et créez un projet (ex. « LeadFinder »). Aucune facturation à activer.
2. **API et services → Bibliothèque** → **PageSpeed Insights API** → **Activer**.
3. **API et services → Identifiants → Créer des identifiants → Clé API** → restreignez-la à *PageSpeed Insights API*.
3. Collez-la dans **Paramètres → Clé PageSpeed Insights**.

Sans clé, l'API utilise un quota partagé presque toujours épuisé : l'audit fonctionne quand même, mais sans les mesures PageSpeed (la fiche l'indique : « PageSpeed non mesuré »).

## Fonctionnement

**Recherche** : secteur (16 secteurs prédéfinis) ou mot-clé, noms d'entreprises (un par ligne), une ou plusieurs villes (séparées par des virgules), code postal, pays. Chaque combinaison ville × nom lance une requête. Les doublons sont fusionnés (même ID OSM, même téléphone, ou même nom + code postal/ville) sans jamais écraser vos notes.

**Audit** (lancé automatiquement si un site est trouvé, 3 sites en parallèle) — note /100 par catégorie :
- *Design & UX* : balises HTML obsolètes, Flash, mise en page en tableaux, appel à l'action (tél., e-mail, formulaire), navigation, ancienneté du copyright (simple indice, poids faible).
- *Mobile* : balise viewport, largeurs fixes, accessibilité mobile Lighthouse.
- *Performances* : temps de réponse, poids HTML, lazy-loading ; avec PageSpeed : score, LCP, CLS, TBT, poids total, images, Core Web Vitals utilisateurs réels si Google les a.
- *SEO* : title, meta description, H1/H2, langue, noindex, canonical, sitemap (via robots.txt), données structurées, Open Graph, attributs alt, URLs lisibles, SEO Lighthouse.
- *Sécurité & technique* : HTTPS / SSL, code HTTP, HSTS, contenu mixte, version WordPress et jQuery, bonnes pratiques Lighthouse.

Un point non vérifié est affiché « Non vérifié » et n'entre pas dans la note. Le design visuel (goût, esthétique) n'est pas jugé automatiquement : seuls des critères techniques objectifs sont utilisés. Un site protégé contre les robots (HTTP 401/403/429/503) n'est pas audité et ne reçoit pas de note : c'est à vérifier à la main.

**Score commercial /100** (toujours détaillé dans la fiche, avec les points de chaque motif) :
- *Sans site* : 60 + réseaux sociaux seuls (+10) + fiche annuaire seule (+5) + coordonnées disponibles (+10) ou aucune coordonnée (−15) (les bonus « avis Google » et « bonne note » du code ne s'appliquent pas avec OpenStreetMap, qui ne fournit pas ces données).
- *Avec site audité* : (100 − note globale de l'audit) + site obsolète (+15) + coordonnées (+5) + activité (+5). Principaux problèmes listés en motifs.
- *Obsolète* = mobile < 50 ou design/technique < 50. *À améliorer* = note globale < 75. Sinon *Site correct*.
- Priorités : **80–100 prioritaire**, **50–79 intéressant**, **0–49 faible**.

**Suivi** : sauvegarde, statut (Nouveau, À contacter, Contacté, En discussion, Client, Non intéressé), étoile « intéressant », date de dernier contact, notes, historique de commentaires, suppression, détection des doublons.

**Export** CSV (séparateur `;`, UTF-8 pour Excel) ou Excel `.xlsx` : la sélection, ou toute la liste filtrée si rien n'est sélectionné. Contient coordonnées, sources, score, motifs, catégorie, notes d'audit, problèmes, statut, notes et historique.

## Données, RGPD et conditions d'utilisation

- Tout est stocké localement (`chrome.storage.local`), rien n'est envoyé ailleurs que vers les services appelés (OpenStreetMap, PageSpeed, sites audités).
- Seules des données professionnelles publiées publiquement sont collectées. En B2B en France, la prospection par e-mail vers une adresse professionnelle est permise si le message concerne l'activité de la personne et propose un moyen de s'opposer ; supprimez les données d'une entreprise qui le demande (bouton Supprimer dans la fiche).
- OpenStreetMap : données © contributeurs OpenStreetMap, licence ODbL. Respectez les règles d'usage de Nominatim (1 requête/s, déjà appliqué) et d'Overpass (pas de recherches massives en boucle).
- Aucun contournement de CAPTCHA, d'anti-robots ou d'authentification.

## Architecture

```
leadfinder/
├── manifest.json        Manifest V3 (storage, host_permissions pour auditer n'importe quel site)
├── popup.html / .js     Popup : chiffres clés + ouverture du tableau de bord
├── app.html / .css / .js Tableau de bord (UI uniquement)
├── icons/
├── src/
│   ├── sources/osm.js     Connecteur OpenStreetMap (Nominatim + Overpass, serveurs de secours)
│   ├── sectors.js         Secteurs et filtres OSM
│   ├── process.js         Normalisation, détection réseaux sociaux/annuaires, fusion, doublons
│   ├── audit.js           Audit de site + extraction des contacts + PageSpeed
│   ├── scoring.js         Notes par catégorie, score commercial, priorités
│   ├── storage.js         chrome.storage.local
│   ├── export.js          CSV + XLSX (écrit sans dépendance)
│   ├── i18n.js            Français / anglais
│   └── util.js
└── tests/test.mjs       Tests : node tests/test.mjs
```

Pour ajouter une source (Pages Jaunes API, SIRENE/INSEE…) : créez `src/sources/xxx.js` qui renvoie des objets `{ name, address, city, postcode, phone, website, …, src: { champ: 'NomSource' } }` et branchez-la dans `runSearch` (app.js).
