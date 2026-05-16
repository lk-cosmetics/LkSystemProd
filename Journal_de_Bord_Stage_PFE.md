# JOURNAL DE BORD — STAGE DE FIN D'ÉTUDES (PFE)

---

| **Stagiaire**        | Hajji Saker                                     |
|----------------------|-------------------------------------------------|
| **Établissement**    | ESPRIT — École Supérieure Privée d'Ingénierie et de Technologies |
| **Entreprise d'accueil** | —                                           |
| **Tuteur de stage**  | —                                               |
| **Poste occupé**     | Développeur Full Stack (Frontend & Backend)     |
| **Projet**           | LK System — Plateforme de gestion multi-canal  |
| **Durée du stage**   | 10 semaines                                     |
| **Technologie principale** | React 19 · TypeScript · Django REST Framework |

---

## Présentation du projet

Le projet **LK System** est une application web de gestion commerciale multi-canal destinée aux entreprises ayant plusieurs points de vente et boutiques en ligne. La plateforme permet de gérer les produits, les stocks, les commandes, les clients, les promotions et les canaux de vente (WooCommerce, POS, Web) depuis une interface unifiée.

Mon rôle a été de contribuer à la fois au **frontend** (React 19 / TypeScript / Tailwind CSS) et au **backend** (Django REST Framework / Python) pour implémenter plusieurs modules clés de l'application.

---

---

## SEMAINE 1 — Intégration, découverte et mise en place de l'environnement

### Tâches et activités réalisées

Ma première semaine de stage a été consacrée à la prise en main de l'environnement de travail et à la compréhension du projet existant. Mon tuteur m'a présenté l'équipe, l'architecture globale du système et les outils utilisés.

**Côté Frontend :**
- Installation et configuration de l'environnement de développement : Node.js, npm, Vite, VS Code
- Exploration de l'architecture du projet React (organisation des dossiers : `pages/`, `components/`, `services/`, `hooks/`, `types/`)
- Lecture du code existant pour comprendre le routing (React Router v7), la gestion d'état (Zustand), et le système de requêtes API (TanStack React Query)
- Prise en main des composants UI basés sur Radix UI et Tailwind CSS

**Côté Backend :**
- Mise en place de l'environnement Python : virtualenv, Django, installation des dépendances
- Lecture de la structure Django : apps, modèles, serializers, views, URLs
- Compréhension du système d'authentification JWT déjà en place
- Exploration de la base de données et des relations entre les modèles

### Ce que j'ai appris

J'ai appris à naviguer dans un projet existant de grande envergure sans être perdu. J'ai découvert l'architecture **monorepo** front/back séparés, communiquant via une API REST. J'ai aussi appris à lire et comprendre du code TypeScript fortement typé, notamment les interfaces définies dans `src/types/index.ts` qui centralisent tous les types métier de l'application.

### Compétences mobilisées

- Lecture et analyse d'un codebase existant
- Configuration d'un environnement de développement full stack
- Communication avec l'équipe pour clarifier les ambiguïtés

### Difficultés rencontrées et solutions apportées

La principale difficulté a été de comprendre le flux d'authentification JWT, qui utilise un stockage en mémoire pour le token d'accès (et non dans le `localStorage`) pour des raisons de sécurité. La lecture des intercepteurs Axios dans `src/services/axios.ts` et les échanges avec mon tuteur m'ont permis de comprendre pourquoi ce choix architectural a été fait : éviter les attaques XSS qui pourraient voler un token stocké côté navigateur.

---

## SEMAINE 2 — Module d'authentification et gestion des routes protégées

### Tâches et activités réalisées

**Frontend :**
- Amélioration de la page de connexion (`src/pages/login.tsx` et `src/components/login-form.tsx`) : validation des champs avec React Hook Form + Zod, affichage des erreurs inline
- Implémentation des pages **Mot de passe oublié** (`ForgotPasswordPage.tsx`) et **Réinitialisation du mot de passe** (`ResetPasswordPage.tsx`) avec gestion des tokens de réinitialisation
- Mise en place du composant `ProtectedRoute.tsx` pour rediriger les utilisateurs non connectés
- Implémentation du composant `RoleGuard.tsx` permettant d'afficher ou masquer des éléments d'interface selon le rôle de l'utilisateur connecté

**Backend :**
- Création des endpoints REST pour la réinitialisation de mot de passe :
  - `POST /api/v1/auth/forgot-password/` — envoi d'un e-mail avec token
  - `POST /api/v1/auth/validate-reset-token/` — validation du token
  - `POST /api/v1/auth/reset-password/` — mise à jour du mot de passe
- Configuration de l'envoi d'e-mails via Django (SMTP)
- Ajout de la logique d'expiration des tokens de réinitialisation (durée de vie : 1 heure)

### Ce que j'ai appris

J'ai appris à implémenter un **flux de réinitialisation de mot de passe sécurisé** de bout en bout, en gérant les tokens à durée limitée et en m'assurant qu'un token ne peut être utilisé qu'une seule fois. Côté frontend, j'ai approfondi ma maîtrise de **React Hook Form** combiné à **Zod** pour la validation de formulaires de manière déclarative.

### Compétences mobilisées

- Développement full stack (Django REST + React)
- Validation de formulaires (Zod schemas)
- Sécurité applicative (tokens JWT, gestion des expirations)
- Envoi d'e-mails transactionnels (SMTP)

### Difficultés rencontrées et solutions apportées

J'ai rencontré un problème de **CORS** lors des appels depuis le frontend vers le backend Django pendant les tests. La solution a été de configurer correctement `django-cors-headers` dans les settings Django et de s'assurer que les credentials (cookies) étaient inclus dans les requêtes Axios avec `withCredentials: true`. J'ai également eu du mal à déboguer la synchronisation entre le token en mémoire et le refresh token en cookie HttpOnly, mais la lecture attentive des intercepteurs Axios m'a permis de comprendre le mécanisme.

---

## SEMAINE 3 — Module Produits : CRUD, gestion des catégories et des marques

### Tâches et activités réalisées

**Frontend :**
- Développement de la page **Produits** (`ProductsPage.tsx`) avec tableau de données paginé, filtres et recherche
- Implémentation des dialogs de création/modification de produit avec gestion de l'image, du type (`resell` / `packaging`), du statut (`draft`, `published`, `pending`) et du code-barres
- Ajout de la fonctionnalité de **suppression douce** (soft delete) avec possibilité de restauration
- Développement des pages **Catégories** et **Marques** avec gestion de la hiérarchie de catégories (arbre parent/enfant)

**Backend :**
- Conception et implémentation du modèle `Product` avec les champs nécessaires (barcode, type, statut, pack/bundle)
- Création des serializers Django REST pour la création, mise à jour et listing des produits
- Implémentation de la logique de soft delete (champ `deleted_at`) et endpoint de restauration
- Développement du modèle `CategoryTree` pour la hiérarchie de catégories
- Endpoints CRUD complets pour produits, catégories et marques

### Ce que j'ai appris

J'ai appris le pattern du **soft delete** (suppression logique) qui consiste à ne pas supprimer physiquement les enregistrements en base mais à les marquer avec une date de suppression. Cette approche permet de restaurer des données supprimées par erreur et de conserver l'historique. J'ai également appris à gérer une **structure hiérarchique** (arbre de catégories) en base de données avec des relations auto-référencées.

### Compétences mobilisées

- Modélisation de base de données (Django ORM)
- Développement d'API REST paginées avec filtres
- Gestion de fichiers (upload d'images de produits)
- Composants de tableaux de données réutilisables (React)

### Difficultés rencontrées et solutions apportées

La gestion des **produits bundle/pack** (produits composés d'autres produits) a été complexe à modéliser. J'ai dû créer une relation many-to-many entre produits avec un champ de quantité. Après discussion avec mon tuteur, nous avons opté pour une table pivot `ProductComponent` avec les champs `product`, `component`, et `quantity`. Pour le frontend, l'interface de sélection des composants d'un pack a nécessité un composant de sélection multiple avec recherche dynamique.

---

## SEMAINE 4 — Module POS (Point de Vente) — Partie 1 : Interface et panier

### Tâches et activités réalisées

**Frontend :**
- Développement de l'interface POS (`POSPage.tsx`) avec un layout responsive : grille de produits à gauche, panier à droite sur desktop, drawer (tiroir) en bas sur mobile
- Implémentation du composant `POSProductGrid.tsx` : affichage des produits en carte avec filtre par catégorie
- Développement du composant `POSCart.tsx` : gestion du panier avec ajout/suppression de produits, modification des quantités, calcul automatique du total et de la TVA
- Implémentation du composant `POSCalculator.tsx` : calculatrice intégrée pour les caissiers

**Backend :**
- Création de l'endpoint spécial `POST /api/v1/orders/pos/` pour la création de commandes POS
- Validation de la disponibilité du stock lors de la création d'une commande POS
- Décrément automatique du stock lors de la finalisation d'une vente

### Ce que j'ai appris

J'ai appris à concevoir une interface utilisateur adaptée à **deux contextes d'usage différents** (desktop avec souris et mobile tactile) en utilisant les utilitaires responsives de Tailwind CSS et le composant Drawer de la librairie Vaul. J'ai également appris l'importance de l'**optimistic update** dans React Query : mettre à jour l'interface immédiatement avant que la réponse du serveur n'arrive, pour une meilleure expérience utilisateur.

### Compétences mobilisées

- Design responsive (Tailwind CSS breakpoints)
- Gestion d'état local complexe (Zustand pour le panier)
- Calculs financiers (TVA, remises, totaux)
- Optimistic updates avec TanStack React Query

### Difficultés rencontrées et solutions apportées

La synchronisation de l'état du panier entre plusieurs composants (grille produits, panier, section client) a posé problème initialement avec un état React local. J'ai migré vers un **store Zustand** dédié au POS, ce qui a simplifié considérablement la communication entre composants et éliminé les problèmes de prop drilling. La calculatrice a aussi été délicate à implémenter en évitant les problèmes de précision des nombres flottants en JavaScript (j'ai utilisé des entiers en centimes pour les calculs).

---

## SEMAINE 5 — Module POS — Partie 2 : Scanner de code-barres et gestion client

### Tâches et activités réalisées

**Frontend :**
- Intégration du scanner de codes-barres physique (lecteur USB) via l'écoute des événements clavier sur l'input de recherche
- Développement du composant `POSCameraScanner.tsx` utilisant la librairie `html5-qrcode` pour scanner via la caméra du téléphone ou de l'ordinateur
- Développement du dialog `POSAddClientDialog.tsx` permettant au caissier de créer un nouveau client rapidement pendant une vente
- Implémentation du dialog `POSClientPromptDialog.tsx` pour proposer l'association d'un client à la commande
- Développement des templates d'impression : `POSReceiptPrint.tsx` (ticket de caisse) et `POSInvoicePrint.tsx` (facture)

**Backend :**
- Endpoint de recherche de produit par code-barres : `GET /api/v1/products/?barcode=xxx`
- Création rapide de client avec les champs minimaux (nom, téléphone) depuis le POS

### Ce que j'ai appris

J'ai appris à intégrer des **périphériques matériels** (lecteur de codes-barres USB) dans une application web. Un lecteur de codes-barres USB fonctionne comme un clavier : il envoie des caractères très rapidement suivis d'un Enter. Il faut donc détecter cette séquence et différencier une saisie manuelle d'une lecture par scanner. J'ai aussi découvert l'API `getUserMedia` utilisée par `html5-qrcode` pour accéder à la caméra, ainsi que les problèmes de permissions navigateur associés.

### Compétences mobilisées

- Intégration de périphériques matériels (barcode reader)
- Accès à la caméra via Web APIs
- Développement de templates d'impression CSS (media print)
- UX design pour interface caissier (rapidité, ergonomie)

### Difficultés rencontrées et solutions apportées

L'accès à la caméra via `html5-qrcode` ne fonctionnait pas en `http://` (seulement en `https://` ou `localhost`). En développement, ce problème n'existait pas car on utilisait `localhost`, mais pour les tests sur un appareil mobile connecté au même réseau, j'ai dû configurer un certificat SSL auto-signé via Vite avec l'option `server.https`. Pour la détection du scanner USB, j'ai implémenté une heuristique basée sur le temps entre les frappes de touches : si plus de 10 caractères arrivent en moins de 100ms, c'est un scanner.

---

## SEMAINE 6 — Module Commandes : Cycle de vie et synchronisation WooCommerce

### Tâches et activités réalisées

**Frontend :**
- Développement de la page `OrdersPage.tsx` avec tableau de commandes, filtres multicritères (statut, source, mode de paiement, dates)
- Affichage de **KPIs** (nombre de commandes, revenus, taux d'annulation) en haut de la page avec des cartes métriques
- Implémentation des dialogs de création/modification de commande (`OrderDialogs.tsx`) avec gestion des lignes de commande, du statut et du résultat (confirmé, retardé, annulé)
- Développement de la fonctionnalité de **synchronisation WooCommerce** : dialog de prévisualisation des commandes à synchroniser, puis synchronisation sélective

**Backend :**
- Implémentation de la logique de cycle de vie des commandes (statuts : pending, confirmed, shipped, delivered, cancelled)
- Endpoint de résumé des commandes : `GET /api/v1/orders/summary/`
- Intégration de l'API WooCommerce REST pour la récupération et synchronisation des commandes
- Endpoint de log d'historique des commandes : `POST /api/v1/orders/{id}/log/`

### Ce que j'ai appris

J'ai appris à intégrer une **API tierce (WooCommerce)** dans un système existant. La synchronisation bidirectionnelle (importer les commandes WooCommerce et mettre à jour les statuts) est un problème classique d'intégration qui nécessite de gérer les conflits, les doublons et la gestion des erreurs réseau. J'ai aussi appris l'importance des **logs d'historique** pour tracer les changements d'état d'une commande (qui a fait quoi et quand).

### Compétences mobilisées

- Intégration d'API tierces (WooCommerce REST API)
- Gestion de machines à états (order status workflow)
- Développement de tableaux de bord avec KPIs
- Filtres et recherches avancées côté serveur

### Difficultés rencontrées et solutions apportées

La synchronisation WooCommerce a posé un problème de **mapping de données** : les champs de WooCommerce n'ont pas toujours les mêmes noms ou structures que notre modèle interne. J'ai créé une couche de transformation (mapper) côté backend pour normaliser les données entrantes. Un autre défi a été d'éviter de créer des doublons lors des synchronisations successives : j'ai utilisé le champ `woocommerce_id` comme identifiant de déduplication avec une logique `get_or_create` de Django.

---

## SEMAINE 7 — Module Clients et Gestion des Stocks (Inventaire)

### Tâches et activités réalisées

**Frontend :**
- Développement de la page `ClientsPage.tsx` : listing avec search, filtres par source (WooCommerce / POS / Manuel), actions de blocage/déblocage
- Affichage des informations client avec points de fidélité et historique de commandes
- Développement de la page `InventoryPage.tsx` : suivi des stocks par canal de vente, mouvements de stock, transferts entre canaux
- Visualisation des niveaux de stock avec alertes de seuil bas (badge coloré)

**Backend :**
- Endpoints client avec logique de blocage (`POST /api/v1/clients/{id}/block/`)
- Modèle `SalesChannelInventory` pour stocker le niveau de stock par canal
- Modèle `InventoryMovement` avec types : `PURCHASE`, `SALE`, `RETURN`, `TRANSFER`, `ADJUSTMENT`, `DAMAGE`
- Endpoint d'ajustement de stock avec création automatique d'un mouvement pour traçabilité
- Endpoint de transfert de stock entre canaux de vente

### Ce que j'ai appris

J'ai appris le concept de **traçabilité des mouvements de stock** : chaque modification du niveau de stock doit être accompagnée d'un mouvement enregistré qui explique la raison de la modification. Ce pattern permet d'auditer l'historique, de détecter des anomalies et de reconstituer l'état du stock à n'importe quel point dans le temps. C'est une pratique essentielle dans les systèmes ERP.

### Compétences mobilisées

- Modélisation d'un système de gestion de stocks
- Transactions de base de données (atomicité des transferts)
- Visualisation de données (indicateurs colorés, seuils)
- Filtres avancés (multi-source, multi-statut)

### Difficultés rencontrées et solutions apportées

Les **transferts de stock** entre canaux ont posé un problème d'intégrité : il fallait décrémenter le stock d'un canal et incrémenter celui d'un autre de manière **atomique** (les deux opérations réussissent ou échouent ensemble). J'ai utilisé les transactions Django (`transaction.atomic()`) pour garantir cette atomicité. Côté frontend, le calcul du solde final après ajustement était affiché en temps réel pendant la saisie, ce qui nécessitait une gestion fine de l'état du formulaire.

---

## SEMAINE 8 — Canaux de Vente, Webhooks et Intégration WooCommerce

### Tâches et activités réalisées

**Frontend :**
- Développement de la page `SalesChannelsPage.tsx` avec configuration des canaux (WooCommerce, POS, Web)
- Interface de configuration WooCommerce : saisie de l'URL de la boutique, des clés API consumer key/secret
- Génération et affichage des **tokens de webhook** pour la réception d'événements WooCommerce
- Gestion des communes/gouvernorats tunisiens (`useMunicipalities.ts`) pour la livraison
- Activation/désactivation et sélection du canal par défaut

**Backend :**
- Endpoint de regénération de token de webhook : `POST /api/v1/sales-channels/{id}/regenerate-webhook/`
- Récepteur de webhooks WooCommerce : validation de la signature HMAC des événements entrants
- Traitement des événements webhook : création/mise à jour de commandes et produits en temps réel
- Modèle `Municipality` avec les gouvernorats et délégations de Tunisie

### Ce que j'ai appris

J'ai découvert le mécanisme des **webhooks** : au lieu de poller régulièrement une API pour vérifier s'il y a du nouveau, on enregistre une URL sur le service tiers qui appellera cette URL automatiquement lors d'événements. C'est plus efficace car on reçoit les mises à jour en temps réel. J'ai aussi appris à valider la signature HMAC des webhooks entrants pour s'assurer qu'ils proviennent bien de WooCommerce et non d'un acteur malveillant.

### Compétences mobilisées

- Intégration webhooks (réception et validation)
- Sécurité : validation HMAC SHA-256
- Gestion de données géographiques (communes, gouvernorats)
- Configuration d'intégrations tierces (WooCommerce API)

### Difficultés rencontrées et solutions apportées

La validation des webhooks WooCommerce nécessite de lire le corps brut de la requête HTTP avant que Django ne le parse. J'ai eu un problème car Django décode le corps de la requête, ce qui empêchait le calcul correct du HMAC. La solution a été d'accéder à `request.body` (bytes bruts) avant le parsing pour calculer la signature, puis de parser ensuite avec `json.loads()`. Pour les tests des webhooks en développement local, j'ai utilisé **ngrok** pour exposer temporairement mon serveur local sur internet.

---

## SEMAINE 9 — Gestion des Rôles (RBAC), Utilisateurs et Promotions

### Tâches et activités réalisées

**Frontend :**
- Développement de la page `RolesPage.tsx` : interface flexible de gestion des rôles avec assignation de permissions granulaires par module (produits, commandes, clients, etc.) et par action (lecture, création, modification, suppression)
- Page `UsersPage.tsx` : gestion des utilisateurs avec assignation de rôle, de marque et d'entreprise
- Développement de la page `PromotionsPage.tsx` : création de promotions avec règles multi-canaux, montant fixe ou pourcentage, dates de validité, limites d'utilisation
- Intégration du composant `RoleGuard.tsx` dans tout le sidebar et les pages pour masquer/désactiver les éléments selon les permissions de l'utilisateur connecté

**Backend :**
- Implémentation du système RBAC (Role-Based Access Control) avec `rbac.service.ts` côté frontend et les vérifications côté backend via des permissions Django personnalisées
- Endpoint de calcul de remise : `GET /api/v1/promotions/calculate-discount/` pour calculer la remise applicable à un produit en fonction des promotions actives et de leur priorité

### Ce que j'ai appris

J'ai appris à implémenter un système de **contrôle d'accès basé sur les rôles (RBAC)** qui est un pattern fondamental dans les applications d'entreprise. La complexité vient de la nécessité d'appliquer les restrictions à la fois côté backend (pour la sécurité réelle) et côté frontend (pour l'expérience utilisateur). J'ai aussi appris la logique de **priorité des promotions** : quand plusieurs promotions s'appliquent à un produit, laquelle prend effet ? (On utilise le champ `priority` et la logique de `stackable`).

### Compétences mobilisées

- Conception et implémentation d'un système RBAC
- Permissions Django personnalisées
- Logique métier des promotions et remises
- Interface d'administration des utilisateurs

### Difficultés rencontrées et solutions apportées

La page de gestion des rôles devait être **flexible et dynamique** : les permissions sont groupées par module, et chaque module peut avoir un jeu différent d'actions disponibles. Construire l'interface de manière générique (sans coder en dur chaque module) a demandé une réflexion sur la structure des données. J'ai opté pour un objet de configuration des permissions (un dictionnaire module → actions disponibles) qui génère dynamiquement les cases à cocher. Côté backend, j'ai utilisé des decorators Django personnalisés pour vérifier les permissions de manière déclarative sur chaque view.

---

## SEMAINE 10 — Dashboard Statistiques, Profil Utilisateur et Finalisation

### Tâches et activités réalisées

**Frontend :**
- Développement du **dashboard statistique** (`StatisticsPage.tsx`) avec graphiques interactifs (Recharts) : évolution des ventes, répartition par canal, top produits, KPIs globaux
- Page **Profil utilisateur** (`ProfilePage.tsx`) avec modification des informations personnelles, changement de photo et modification du mot de passe
- Création du hook `useProfile.ts` et `useMunicipalities.ts` pour centraliser les appels API liés au profil
- Amélioration du composant `nav-user.tsx` dans la sidebar avec menu déroulant (profil, paramètres, déconnexion)
- Tests manuels de bout en bout sur les principaux flux utilisateur
- Correction de bugs identifiés lors des tests (gestion des cas limites, messages d'erreur)

**Backend :**
- Endpoint de statistiques pour alimenter le dashboard
- Revue et documentation des endpoints existants
- Optimisation de requêtes N+1 identifiées avec Django Debug Toolbar (`select_related`, `prefetch_related`)

### Ce que j'ai appris

J'ai appris l'importance de l'**optimisation des performances** dans une API Django. Le problème N+1 est un anti-pattern classique où une requête génère N requêtes supplémentaires en base de données (une par objet chargé). En utilisant `select_related()` pour les FK et `prefetch_related()` pour les many-to-many, j'ai réduit le nombre de requêtes SQL de manière significative. J'ai aussi appris à construire des graphiques interactifs avec Recharts en transformant les données API en format accepté par la librairie.

### Compétences mobilisées

- Visualisation de données (Recharts : AreaChart, BarChart, LineChart)
- Optimisation des requêtes Django (select_related, prefetch_related)
- Tests manuels et identification de bugs
- Débogage et correction de bugs (edge cases)

### Difficultés rencontrées et solutions apportées

Les graphiques Recharts nécessitent des données dans un format très spécifique. Les données renvoyées par l'API avaient une structure différente, ce qui m'a obligé à écrire des fonctions de transformation côté frontend. J'ai créé des **helpers de transformation** dans un fichier utilitaire pour garder les composants propres. Pour le dashboard profil, la mise à jour de la photo de profil nécessitait un upload `multipart/form-data` avec Axios, que j'ai dû gérer différemment des requêtes JSON classiques.

---

---

## BILAN GÉNÉRAL DU STAGE

### Compétences techniques acquises

**Frontend :**
| Technologie | Niveau avant | Niveau après |
|-------------|:------------:|:------------:|
| React / TypeScript | Intermédiaire | Avancé |
| TanStack React Query | Débutant | Intermédiaire |
| Tailwind CSS | Intermédiaire | Avancé |
| React Hook Form + Zod | Débutant | Intermédiaire |
| Zustand (state management) | Débutant | Intermédiaire |
| Radix UI / composants accessibles | Débutant | Intermédiaire |

**Backend :**
| Technologie | Niveau avant | Niveau après |
|-------------|:------------:|:------------:|
| Django REST Framework | Intermédiaire | Avancé |
| Modélisation de base de données | Intermédiaire | Avancé |
| JWT / Authentification | Débutant | Intermédiaire |
| Intégration API tierces | Débutant | Intermédiaire |
| Optimisation de requêtes ORM | Débutant | Intermédiaire |

### Missions accomplies

- Module d'authentification complet (login, JWT, reset password, routes protégées)
- Module Produits avec CRUD, soft delete, catégories hiérarchiques
- Module POS avec scanner de codes-barres (USB + caméra), panier, impression de tickets/factures
- Module Commandes avec cycle de vie, synchronisation WooCommerce, KPIs
- Module Clients avec blocage/déblocage, historique
- Module Inventaire avec mouvements de stock, transferts multi-canal
- Module Canaux de vente avec configuration WooCommerce et webhooks
- Module Rôles et RBAC avec permissions granulaires
- Module Utilisateurs avec assignation de rôles
- Module Promotions avec règles multi-canaux et calcul de remises
- Dashboard statistique avec graphiques interactifs
- Gestion du profil utilisateur

### Réflexion personnelle

Ce stage a été une expérience extrêmement enrichissante qui m'a permis de **sortir du cadre théorique** de la formation pour affronter de vrais défis techniques en conditions professionnelles. Travailler sur un projet de production m'a appris que la qualité du code, la maintenabilité et la sécurité ne sont pas des options mais des exigences fondamentales.

La partie que j'ai trouvée la plus stimulante a été l'intégration avec WooCommerce, car elle m'a obligé à penser au-delà de ma propre application et à comprendre comment deux systèmes distincts peuvent communiquer de manière fiable. La partie la plus difficile a été la gestion d'état du module POS, qui m'a poussé à maîtriser Zustand et à réfléchir sérieusement à l'architecture des données côté client.

Ce stage confirme mon intérêt pour le développement full stack et, en particulier, pour la conception de systèmes distribués et d'intégrations entre plateformes.

---

*Journal de bord rédigé selon les recommandations ESPRIT — AZ2021*
*Dernière mise à jour : Semaine 10*
