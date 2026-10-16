# Solcast

Cette intégration amène dans Gladys les **prévisions de production solaire**
que [Solcast](https://solcast.com) calcule pour votre installation
photovoltaïque, avec un compte Solcast gratuit **« Home User »** (hobbyist).
Elle complète l'intégration
[Forecast.Solar](https://github.com/prohand/gladys-forecastsolar) : mêmes
capteurs, mêmes unités, pour comparer les deux prévisions côte à côte. Non
officiel, sans lien avec Solcast.

Nécessite **Gladys 5.1.0** ou plus récent.

> **Version de développement (0.1).** Écrite d'après la documentation de
> Solcast et l'intégration communautaire de Home Assistant, testée avec des
> réponses simulées, pas encore avec un vrai compte Solcast. Vos retours sont
> les bienvenus sur le dépôt GitHub.

## Solcast ou Forecast.Solar ?

Les deux si vous voulez : elles n'utilisent pas les mêmes données.

|                  | Solcast (cette intégration)                                           | Forecast.Solar                                 |
| ---------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Source           | images satellite (nuages en ce moment) et modèles météo               | modèles météo                                  |
| Fourchette       | P10 (journée terne) et P90 (journée lumineuse) autour de la prévision | la prévision seule                             |
| Pans de toit     | jusqu'à 2 sites (par exemple est et ouest)                            | un pan dans l'intégration                      |
| Compte           | compte Solcast gratuit, clé d'API                                     | aucun                                          |
| Requêtes         | **10 par jour UTC** pour tout le compte                               | 12 par heure                                   |
| Panneaux décrits | dans le toolkit Solcast                                               | dans la configuration et les maisons de Gladys |

## Le compte Solcast gratuit (vérifié le 16 octobre 2026)

Solcast ouvre toujours des comptes gratuits **« Home User »** : sur
[toolkit.solcast.com.au/register](https://toolkit.solcast.com.au/register),
l'offre « Home User » est destinée aux particuliers qui n'ont besoin que des
prévisions de production de leur toiture, pour un seul site résidentiel de
moins de 50 kW. La documentation de Solcast (Rooftop Sites (Hobbyist)) en
donne les limites :

- **10 requêtes d'API par jour UTC** (remise à zéro à minuit UTC, soit 1 h
  ou 2 h du matin en France), pour tous les sites du compte ensemble.
  Certains comptes créés avant la baisse de la limite gardent 50 requêtes
  par jour ;
- **2 sites au plus** (deux champs de panneaux), à moins d'1 km l'un de
  l'autre ;
- des périodes de 30 minutes, estimations en direct et prévisions
  seulement, pour un usage personnel.

Lire la liste des sites de la clé ne consomme pas de requête ; chaque
prévision d'un site en consomme une.

### Créer le compte et les sites

1. Ouvrez [toolkit.solcast.com.au/register](https://toolkit.solcast.com.au/register),
   choisissez **Home User**, inscrivez-vous et confirmez votre e-mail.
2. Sur le tableau de bord, cliquez sur **Add your first Home PV system** :
   position, puissance (AC et DC, en kW), **azimut**, **inclinaison**, date
   d'installation et facteur d'efficacité, puis enregistrez.
   - L'azimut de Solcast se compte **depuis le nord** : 0° = nord,
     90° = ouest, 180° = sud, -90° = est (Forecast.Solar compte depuis le
     sud : son 0° est le 180° de Solcast).
3. Pour un second pan de toit (est/ouest, garage…), cliquez sur **Add
   another Home PV system** et donnez-lui **la même latitude et la même
   longitude** que le premier (sinon Solcast le refuse : les deux doivent
   être à moins d'1 km).
4. Copiez la **clé d'API** dans le menu du compte (votre nom d'utilisateur,
   en haut à droite).
5. Facultatif : l'**identifiant (resource id)** de chaque site est sur sa
   page **View site detail**. Il ne sert que pour n'utiliser qu'un site sur
   les deux (voir les options).

## Installation

1. Installez l'intégration depuis le store de Gladys.
2. Dans l'onglet **Configuration**, collez la clé d'API et enregistrez. Le
   statut indique « Connecté à Solcast : 2 sites » (lire les sites ne
   consomme aucune requête).
3. Ouvrez l'onglet **Découverte** et ajoutez les sites à suivre, ainsi que
   « Prévision Solcast (tous les sites) » pour le total des deux. **Seuls
   les sites ajoutés sont téléchargés** : rien n'est consommé avant.
4. La première prévision est téléchargée aussitôt ; les valeurs arrivent
   avec elle.

## Ce que vous obtenez

Un appareil par site et, avec deux sites, un pour leur total. Chacun a 12
capteurs en lecture seule :

| Capteur                              | Unité | Contenu                                         |
| ------------------------------------ | ----- | ----------------------------------------------- |
| Puissance estimée actuelle           | W     | puissance estimée en ce moment                  |
| Énergie estimée aujourd'hui          | kWh   | production estimée de toute la journée          |
| Énergie estimée restante aujourd'hui | kWh   | production estimée jusqu'à la fin de la journée |
| Énergie estimée demain               | kWh   | production estimée du lendemain                 |
| … (P10) et … (P90) de chacun         |       | les bornes « journée terne » et « lumineuse »   |

- Les noms et les unités sont ceux de Forecast.Solar : mettez les deux sur
  un tableau de bord ou un graphique pour les comparer.
- **P50** (les capteurs sans suffixe) est la valeur la plus probable ;
  **P10** une journée terne (9 chances sur 10 de produire plus) ; **P90**
  une journée lumineuse (1 chance sur 10 de produire plus).
- Ce sont des **prévisions**, pas des mesures : elles ne comptent pas dans
  le **suivi de l'énergie** de Gladys (il ne lit que les index de
  production).
- « Aujourd'hui » et « demain » sont les jours du fuseau horaire de Gladys.
- **L'énergie d'aujourd'hui** a besoin de la matinée : Solcast n'envoie la
  prévision qu'à partir de la demi-heure en cours, et l'intégration garde
  les périodes passées de la journée de ses téléchargements précédents.
  Ajouté en cours de journée, un site affiche son « énergie
  d'aujourd'hui » à partir du lendemain (l'énergie restante et celle de
  demain sont là tout de suite).
- Le badge de chaque appareil indique `cloud`, avec un point orange quand
  la prévision a plus de 26 heures (Solcast n'a pas pu être lu depuis).

## Comment les 10 requêtes sont utilisées

- Les téléchargements sont **répartis sur les heures de jour**, lues sur la
  prévision elle-même : le premier au début de la production (une
  prévision fraîche pour la journée), puis régulièrement, le dernier bien
  avant le coucher du soleil. Avec deux sites : 5 téléchargements des deux
  par jour ; avec un site : 10.
- Les requêtes faites sont **comptées et gardées** d'un redémarrage à
  l'autre : redémarrer Gladys ou l'intégration n'en consomme jamais une de
  plus.
- Entre deux téléchargements, les valeurs sont **recalculées toutes les 5
  minutes** à partir de la dernière prévision (la puissance suit la
  courbe), et envoyées à Gladys seulement quand elles changent, ou toutes
  les 30 minutes.
- Quand Solcast est surchargé (HTTP 429 « réessayez plus tard », fréquent
  aux quarts d'heure), l'intégration réessaie 5, 10, 20, 40 puis 60 minutes
  plus tard ; une réponse « surchargé » ne consomme pas de requête. Ses
  téléchargements sont décalés de quelques minutes par rapport aux quarts
  d'heure.
- Quand Solcast indique que la limite quotidienne est atteinte (un autre
  outil utilise la même clé, par exemple), plus rien n'est téléchargé
  jusqu'à minuit UTC ; les valeurs suivent la dernière prévision.
- La prévision couvre 3 jours : même sans téléchargement pendant une
  journée, les valeurs restent connues.

Les **estimations de production réelle** de Solcast (ce que vos panneaux ont
probablement produit) consomment aussi des requêtes : elles ne sont pas
utilisées.

## Boutons

- **Tester la connexion (aucun appel consommé)** : lit les sites de la clé
  et indique le nombre de requêtes restantes aujourd'hui.
- **Mettre à jour la prévision maintenant (consomme des appels)** :
  télécharge tout de suite la prévision des sites ajoutés (une requête par
  site), sauf si elle date de moins de 10 minutes ou qu'il ne reste plus de
  requête ; indique combien il en reste. Les téléchargements automatiques se
  répartissent ensuite ce qui reste.

## Scènes

Quatre déclencheurs de scène, pour un site ou pour tous :

| Déclencheur                              | Quand                                            |
| ---------------------------------------- | ------------------------------------------------ |
| Prévision solaire mise à jour (Solcast)  | à chaque nouvelle prévision (5 à 10 par jour)    |
| Début de la production solaire (Solcast) | début estimé de la production (lever du soleil)  |
| Pic de production solaire (Solcast)      | pic estimé de la journée                         |
| Fin de la production solaire (Solcast)   | fin estimée de la production (coucher du soleil) |

Variables : `site`, `power_now`, `energy_today`, `energy_remaining_today`,
`energy_tomorrow` (chacune avec son `_p10` et son `_p90`), `peak_power`,
`peak_time` (HH:MM) et `calls_left`. Une valeur que la prévision ne connaît
pas est vide. Le début, le pic et la fin se déclenchent une fois par jour,
quand l'heure arrive ; manqués de plus de 5 minutes (Gladys arrêté), ils ne
se déclenchent pas en retard.

Pour un seuil (« si demain > 10 kWh »), utilisez le déclencheur habituel
« Changement d'état d'un appareil » sur le capteur.

## Options

| Option                              | Défaut   | Rôle                                                            |
| ----------------------------------- | -------- | --------------------------------------------------------------- |
| Clé d'API Solcast                   | —        | la clé du menu du compte du toolkit                             |
| Sites (facultatif)                  | vide     | identifiants à utiliser, séparés par des virgules ; vide : tous |
| Appels de prévision par jour        | 10       | la limite du compte (50 pour certains comptes anciens)          |
| Langue des noms des fonctionnalités | français | noms des appareils et fonctionnalités ajoutés désormais         |

Baissez les appels par jour si un autre outil (Home Assistant…) utilise la
même clé : l'intégration ne connaît que ses propres requêtes.

## En cas de problème

- **« Solcast a refusé la clé d'API »** : recopiez-la depuis le toolkit.
  L'intégration attend une modification, ou un clic sur **Tester la
  connexion**.
- **« Cette clé Solcast n'a aucun site »** : ajoutez votre installation
  dans le toolkit, puis **Scanner** dans l'onglet Découverte.
- **« Plus d'appel Solcast aujourd'hui »** : les 10 requêtes du jour UTC
  sont consommées (par cette intégration ou un autre outil). Les valeurs
  suivent la dernière prévision ; le prochain téléchargement vient après
  minuit UTC.
- **« Solcast est surchargé »** : rien à faire, l'intégration réessaie.
- **« L'énergie d'aujourd'hui » reste vide** : le site a été ajouté en cours
  de journée ; elle arrive le lendemain.
- **Des valeurs loin de votre production** : vérifiez l'azimut (depuis le
  nord chez Solcast), l'inclinaison et la puissance du site dans le
  toolkit.
- La page d'état de Solcast (status.solcast.com) ne couvre pas les comptes
  gratuits.

## Vie privée

La clé d'API est stockée par Gladys comme un secret (jamais renvoyée au
navigateur). L'intégration ne l'envoie qu'à `api.solcast.com.au`, dans
l'en-tête d'autorisation. Elle garde les prévisions, les sites et le
compteur de requêtes dans son dossier `/data`, avec une empreinte de la clé
(jamais la clé elle-même). Solcast est une marque de son propriétaire ;
cette intégration est sans lien avec Solcast.
