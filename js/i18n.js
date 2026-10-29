// All text shown on the site, in Macedonian (mk) and English (en).
// To change a text, edit it here. To add a language, copy the "en" block,
// translate it and add the language code to LANGUAGES.

const DEFAULT_LANG = 'mk';
const LANGUAGES = ['mk', 'en'];

const TEXT = {
  mk: {
    pageTitle: 'РиболовМК – мапа за риболов во Северна Македонија',
    siteTitle: 'РиболовМК',
    siteSubtitle: 'Мапа за риболов во Северна Македонија',
    switchLanguage: 'EN',
    switchLanguageLabel: 'Switch to English',
    mapLabel: 'Мапа на реките и езерата во Северна Македонија',
    hint: 'Изберете река или езеро',
    close: 'Затвори',

    filter: 'Филтер',
    filterLabel: 'Прикажи на мапата',
    rivers: 'Реки',
    lakes: 'Езера',
    reservoirs: 'Акумулации',
    cities: 'Градови',
    municipalities: 'Граници на општини',
    zoomIn: 'Зумирај',
    zoomOut: 'Одзумирај',

    river: 'Река',
    lake: 'Езеро',
    reservoir: 'Акумулација',

    fish: 'Видови риби',
    permits: 'Дозвола за риболов',
    issuer: 'Издава',
    contact: 'Контакт',
    price: 'Цена',
    closedSeasons: 'Ловостој',
    catchLimits: 'Дозволен улов',
    minimumSizes: 'Најмала дозволена големина',
    protectedSpecies: 'Заштитени видови',
    noFishingZones: 'Забрането за риболов',
    notes: 'Белешки',

    noInfo: 'Сè уште нема информации за оваа вода.',
    placeholder: 'Пример: ова не се вистински податоци. Не користете ги за риболов.',
    mapLoadError: 'Мапата не може да се вчита. Освежете ја страницата.',
    watersLoadError: 'Податоците за риболов не можат да се вчитаат. Датотеката data/waters.json веројатно има грешка во форматот.',
  },

  en: {
    pageTitle: 'RibolovMK – fishing map of North Macedonia',
    siteTitle: 'RibolovMK',
    siteSubtitle: 'Fishing map of North Macedonia',
    switchLanguage: 'МК',
    switchLanguageLabel: 'Префрли на македонски',
    mapLabel: 'Map of the rivers and lakes of North Macedonia',
    hint: 'Select a river or lake',
    close: 'Close',

    filter: 'Filter',
    filterLabel: 'Show on the map',
    rivers: 'Rivers',
    lakes: 'Lakes',
    reservoirs: 'Reservoirs',
    cities: 'Cities',
    municipalities: 'Municipality borders',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',

    river: 'River',
    lake: 'Lake',
    reservoir: 'Reservoir',

    fish: 'Fish species',
    permits: 'Fishing permits',
    issuer: 'Issued by',
    contact: 'Contact',
    price: 'Price',
    closedSeasons: 'Closed seasons',
    catchLimits: 'Catch limits',
    minimumSizes: 'Minimum sizes',
    protectedSpecies: 'Protected species',
    noFishingZones: 'No-fishing zones',
    notes: 'Notes',

    noInfo: 'No information yet for this water.',
    placeholder: 'Example only: this is not real information. Do not use it for fishing.',
    mapLoadError: 'The map could not be loaded. Reload the page.',
    watersLoadError: 'The fishing information could not be loaded. The file data/waters.json probably has a formatting error.',
  },
};
