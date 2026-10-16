// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges, device and
// feature names), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

/** Both languages of a text built the same way: `fn(language)`. */
const both = (fn) => ({ en: fn('en'), fr: fn('fr') });

const sitesWord = { en: ['site', 'sites'], fr: ['site', 'sites'] };
const callsWord = { en: ['call', 'calls'], fr: ['appel', 'appels'] };
const count = (n, words, language) => plural(n, ...words[language]);

/** 12.34 -> "12.3" / "12,3". */
export function kwh(value, language) {
  const text = (Math.round(value * 10) / 10).toFixed(1);
  return language === 'fr' ? text.replace('.', ',') : text;
}

export const DEVICE_NAMES = {
  site: (name) => ({ en: `Solcast forecast (${name})`, fr: `Prévision Solcast (${name})` }),
  total: { en: 'Solcast forecast (all sites)', fr: 'Prévision Solcast (tous les sites)' },
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  'power-now': { en: 'Estimated power now', fr: 'Puissance estimée actuelle' },
  'energy-today': { en: 'Estimated energy today', fr: "Énergie estimée aujourd'hui" },
  'energy-remaining-today': {
    en: 'Estimated energy remaining today',
    fr: "Énergie estimée restante aujourd'hui",
  },
  'energy-tomorrow': { en: 'Estimated energy tomorrow', fr: 'Énergie estimée demain' },
};

/** "Toit sud (3 kW)". */
const siteLabel = (site, language) =>
  site.capacity === undefined ? site.name : `${site.name} (${kwh(site.capacity, language)} kW)`;

/**
 * When the next download happens, from the plan: { kind, time } with kind
 * `at` (around a time), `reset` (after the UTC midnight), `none` (no device).
 */
const nextText = (next, language) => {
  if (next.kind === 'none') {
    return language === 'fr' ? "dès qu'un site sera ajouté" : 'once a site is added';
  }
  if (next.kind === 'reset') {
    return language === 'fr'
      ? `après ${next.time} (minuit UTC)`
      : `after ${next.time} (midnight UTC)`;
  }
  return language === 'fr' ? `vers ${next.time}` : `around ${next.time}`;
};

const left = ({ left: n, limit }, language) =>
  language === 'fr'
    ? `${n} ${n > 1 ? 'appels' : 'appel'} sur ${limit} restant${n > 1 ? 's' : ''} aujourd'hui`
    : `${n} of ${limit} ${limit === 1 ? 'call' : 'calls'} left today`;

/** The same, at the start of a sentence. */
const Left = (s, language) => {
  const text = left(s, language);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const range = (values, language) =>
  values
    ? `${kwh(values.p50, language)} kWh (P10 ${kwh(values.p10, language)}, P90 ${kwh(values.p90, language)})`
    : language === 'fr'
      ? 'inconnue'
      : 'unknown';

export const T = {
  noKey: {
    en: 'Enter the API key of your Solcast account (Solcast toolkit, account menu).',
    fr: "Saisissez la clé d'API de votre compte Solcast (toolkit Solcast, menu du compte).",
  },
  connecting: {
    en: 'Reading the rooftop sites of the Solcast key…',
    fr: 'Lecture des sites de la clé Solcast…',
  },
  refused: {
    en: 'Solcast refused the API key: check it in the configuration (the integration waits for a change).',
    fr: "Solcast a refusé la clé d'API : vérifiez-la dans la configuration (l'intégration attend une modification).",
  },
  noSites: {
    en: 'This Solcast key has no rooftop site: add your PV system in the Solcast toolkit, then scan again.',
    fr: "Cette clé Solcast n'a aucun site : ajoutez votre installation dans le toolkit Solcast, puis relancez la découverte.",
  },
  unknownSites: (ids) => ({
    en: `No rooftop site of this key has the resource ids of the configuration (${ids.join(', ')}).`,
    fr: `Aucun site de cette clé ne porte les identifiants de la configuration (${ids.join(', ')}).`,
  }),
  sitesUnreachable: (reason) => ({
    en: `Solcast cannot be reached (${reason}): the sites are read again in 10 minutes.`,
    fr: `Solcast est injoignable (${reason}) : nouvelle lecture des sites dans 10 minutes.`,
  }),
  discover: (sites) =>
    both((language) =>
      language === 'fr'
        ? `Connecté à Solcast : ${count(sites, sitesWord, language)}. Ajoutez-les depuis Découverte : seuls les sites ajoutés consomment des appels.`
        : `Connected to Solcast: ${count(sites, sitesWord, language)}. Add them from Discovery: only the added sites use calls.`,
    ),
  /** { forecastAt (HH:MM or null), sites, next, left, limit } */
  status: (s) =>
    both((language) => {
      const head = s.forecastAt
        ? language === 'fr'
          ? `Prévision de ${s.forecastAt} pour ${count(s.sites, sitesWord, language)}.`
          : `Forecast of ${s.forecastAt} for ${count(s.sites, sitesWord, language)}.`
        : language === 'fr'
          ? 'En attente de la première prévision.'
          : 'Waiting for the first forecast.';
      const tail =
        language === 'fr'
          ? `Prochaine mise à jour ${nextText(s.next, language)} ; ${left(s, language)}.`
          : `Next update ${nextText(s.next, language)}; ${left(s, language)}.`;
      return `${head} ${tail}`;
    }),
  exhausted: (next) =>
    both((language) =>
      language === 'fr'
        ? `Plus d'appel Solcast aujourd'hui (limite quotidienne atteinte) : prochaine prévision ${nextText(next, language)}. Les valeurs suivent la dernière prévision.`
        : `No Solcast call left today (daily limit reached): next forecast ${nextText(next, language)}. The values follow the last forecast.`,
    ),
  busy: (next) =>
    both((language) =>
      language === 'fr'
        ? `Solcast est surchargé (HTTP 429, aucun appel consommé) : nouvel essai ${nextText(next, language)}.`
        : `Solcast is busy (HTTP 429, no call used): next try ${nextText(next, language)}.`,
    ),
  unreachable: (reason, next) =>
    both((language) =>
      language === 'fr'
        ? `Solcast est injoignable (${reason}) : nouvel essai ${nextText(next, language)}.`
        : `Solcast cannot be reached (${reason}): next try ${nextText(next, language)}.`,
    ),
  notFound: (name) => ({
    en: `Solcast no longer knows the site ${name}: check it in the toolkit, then scan again.`,
    fr: `Solcast ne connaît plus le site ${name} : vérifiez-le dans le toolkit, puis relancez la découverte.`,
  }),
  stale: (at) => ({
    en: `Forecast of ${at}: Solcast could not be read since.`,
    fr: `Prévision du ${at} : Solcast n'a pas pu être lu depuis.`,
  }),
  test: {
    cooldown: {
      en: 'Already read less than 30 seconds ago.',
      fr: 'Déjà lu il y a moins de 30 secondes.',
    },
    /** { sites: [site], next, left, limit } */
    summary: (s) =>
      both((language) => {
        const list = s.sites.map((site) => siteLabel(site, language)).join(', ');
        return language === 'fr'
          ? `Clé acceptée : ${list}. ${Left(s, language)}, prochaine mise à jour ${nextText(s.next, language)}.`
          : `Key accepted: ${list}. ${Left(s, language)}, next update ${nextText(s.next, language)}.`;
      }),
  },
  refresh: {
    noDevice: {
      en: 'Add a site from Discovery first: only the added sites are downloaded. No call used.',
      fr: "Ajoutez d'abord un site depuis Découverte : seuls les sites ajoutés sont téléchargés. Aucun appel consommé.",
    },
    cooldown: (minutes, s) =>
      both((language) =>
        language === 'fr'
          ? `Déjà téléchargée il y a ${minutes} min : aucun appel consommé. ${Left(s, language)}.`
          : `Already downloaded ${minutes} min ago: no call used. ${Left(s, language)}.`,
      ),
    noCall: (next, s) =>
      both((language) =>
        language === 'fr'
          ? `Plus d'appel Solcast aujourd'hui (${s.limit} par jour) : la limite repart ${nextText(next, language)}.`
          : `No Solcast call left today (${s.limit} a day): the limit resets ${nextText(next, language)}.`,
      ),
    /** { sites, calls, today, tomorrow, next, left, limit } */
    done: (s) =>
      both((language) =>
        language === 'fr'
          ? `Prévision téléchargée pour ${count(s.sites, sitesWord, language)} (${count(s.calls, callsWord, language)}). Aujourd'hui ${range(s.today, language)}, demain ${range(s.tomorrow, language)}. ${Left(s, language)} ; prochaine mise à jour automatique ${nextText(s.next, language)}.`
          : `Forecast downloaded for ${count(s.sites, sitesWord, language)} (${count(s.calls, callsWord, language)}). Today ${range(s.today, language)}, tomorrow ${range(s.tomorrow, language)}. ${Left(s, language)}; next automatic update ${nextText(s.next, language)}.`,
      ),
    failed: (reason, s) =>
      both((language) =>
        language === 'fr'
          ? `Échec du téléchargement (${reason}). ${Left(s, language)}.`
          : `The download failed (${reason}). ${Left(s, language)}.`,
      ),
  },
};
