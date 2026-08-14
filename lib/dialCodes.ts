/**
 * ITU-T E.164 country calling codes, one entry per country/territory.
 *
 * Replaces the 29-entry shortlist PhoneInput used to carry, which forced
 * anyone outside those countries to leave the code wrong or type it into the
 * number field. Sorted by country name; the picker pins a handful of common
 * ones above the rest.
 *
 * Note on shared codes: the NANP (+1) and a few others cover many countries,
 * and only the dial code is persisted with the number. Re-opening a saved
 * "+1 …" number therefore shows the first +1 entry (Canada) rather than the
 * exact country originally chosen — the number itself is unaffected, since
 * every NANP country dials as +1.
 */

export type DialCode = {
  /** E.164 prefix, including the leading "+". */
  code: string;
  /** ISO 3166-1 alpha-2, shown as the compact badge on the closed control. */
  iso: string;
  /** Country name, what the search box matches against. */
  name: string;
};

/** Shown first in the picker — the countries this app is used from most. */
export const POPULAR_ISO = ["IN", "US", "GB", "AE", "SA", "SG", "AU", "DE"];

export const DIAL_CODES: DialCode[] = [
  { name: "Afghanistan", iso: "AF", code: "+93" },
  { name: "Åland Islands", iso: "AX", code: "+358" },
  { name: "Albania", iso: "AL", code: "+355" },
  { name: "Algeria", iso: "DZ", code: "+213" },
  { name: "American Samoa", iso: "AS", code: "+1684" },
  { name: "Andorra", iso: "AD", code: "+376" },
  { name: "Angola", iso: "AO", code: "+244" },
  { name: "Anguilla", iso: "AI", code: "+1264" },
  { name: "Antigua and Barbuda", iso: "AG", code: "+1268" },
  { name: "Argentina", iso: "AR", code: "+54" },
  { name: "Armenia", iso: "AM", code: "+374" },
  { name: "Aruba", iso: "AW", code: "+297" },
  { name: "Australia", iso: "AU", code: "+61" },
  { name: "Austria", iso: "AT", code: "+43" },
  { name: "Azerbaijan", iso: "AZ", code: "+994" },
  { name: "Bahamas", iso: "BS", code: "+1242" },
  { name: "Bahrain", iso: "BH", code: "+973" },
  { name: "Bangladesh", iso: "BD", code: "+880" },
  { name: "Barbados", iso: "BB", code: "+1246" },
  { name: "Belarus", iso: "BY", code: "+375" },
  { name: "Belgium", iso: "BE", code: "+32" },
  { name: "Belize", iso: "BZ", code: "+501" },
  { name: "Benin", iso: "BJ", code: "+229" },
  { name: "Bermuda", iso: "BM", code: "+1441" },
  { name: "Bhutan", iso: "BT", code: "+975" },
  { name: "Bolivia", iso: "BO", code: "+591" },
  { name: "Bonaire, Sint Eustatius and Saba", iso: "BQ", code: "+599" },
  { name: "Bosnia and Herzegovina", iso: "BA", code: "+387" },
  { name: "Botswana", iso: "BW", code: "+267" },
  { name: "Brazil", iso: "BR", code: "+55" },
  { name: "British Virgin Islands", iso: "VG", code: "+1284" },
  { name: "Brunei", iso: "BN", code: "+673" },
  { name: "Bulgaria", iso: "BG", code: "+359" },
  { name: "Burkina Faso", iso: "BF", code: "+226" },
  { name: "Burundi", iso: "BI", code: "+257" },
  { name: "Cambodia", iso: "KH", code: "+855" },
  { name: "Cameroon", iso: "CM", code: "+237" },
  { name: "Canada", iso: "CA", code: "+1" },
  { name: "Cape Verde", iso: "CV", code: "+238" },
  { name: "Cayman Islands", iso: "KY", code: "+1345" },
  { name: "Central African Republic", iso: "CF", code: "+236" },
  { name: "Chad", iso: "TD", code: "+235" },
  { name: "Chile", iso: "CL", code: "+56" },
  { name: "China", iso: "CN", code: "+86" },
  { name: "Christmas Island", iso: "CX", code: "+61" },
  { name: "Cocos (Keeling) Islands", iso: "CC", code: "+61" },
  { name: "Colombia", iso: "CO", code: "+57" },
  { name: "Comoros", iso: "KM", code: "+269" },
  { name: "Congo (Brazzaville)", iso: "CG", code: "+242" },
  { name: "Congo (Kinshasa)", iso: "CD", code: "+243" },
  { name: "Cook Islands", iso: "CK", code: "+682" },
  { name: "Costa Rica", iso: "CR", code: "+506" },
  { name: "Côte d'Ivoire", iso: "CI", code: "+225" },
  { name: "Croatia", iso: "HR", code: "+385" },
  { name: "Cuba", iso: "CU", code: "+53" },
  { name: "Curaçao", iso: "CW", code: "+599" },
  { name: "Cyprus", iso: "CY", code: "+357" },
  { name: "Czechia", iso: "CZ", code: "+420" },
  { name: "Denmark", iso: "DK", code: "+45" },
  { name: "Djibouti", iso: "DJ", code: "+253" },
  { name: "Dominica", iso: "DM", code: "+1767" },
  { name: "Dominican Republic", iso: "DO", code: "+1809" },
  { name: "Ecuador", iso: "EC", code: "+593" },
  { name: "Egypt", iso: "EG", code: "+20" },
  { name: "El Salvador", iso: "SV", code: "+503" },
  { name: "Equatorial Guinea", iso: "GQ", code: "+240" },
  { name: "Eritrea", iso: "ER", code: "+291" },
  { name: "Estonia", iso: "EE", code: "+372" },
  { name: "Eswatini", iso: "SZ", code: "+268" },
  { name: "Ethiopia", iso: "ET", code: "+251" },
  { name: "Falkland Islands", iso: "FK", code: "+500" },
  { name: "Faroe Islands", iso: "FO", code: "+298" },
  { name: "Fiji", iso: "FJ", code: "+679" },
  { name: "Finland", iso: "FI", code: "+358" },
  { name: "France", iso: "FR", code: "+33" },
  { name: "French Guiana", iso: "GF", code: "+594" },
  { name: "French Polynesia", iso: "PF", code: "+689" },
  { name: "Gabon", iso: "GA", code: "+241" },
  { name: "Gambia", iso: "GM", code: "+220" },
  { name: "Georgia", iso: "GE", code: "+995" },
  { name: "Germany", iso: "DE", code: "+49" },
  { name: "Ghana", iso: "GH", code: "+233" },
  { name: "Gibraltar", iso: "GI", code: "+350" },
  { name: "Greece", iso: "GR", code: "+30" },
  { name: "Greenland", iso: "GL", code: "+299" },
  { name: "Grenada", iso: "GD", code: "+1473" },
  { name: "Guadeloupe", iso: "GP", code: "+590" },
  { name: "Guam", iso: "GU", code: "+1671" },
  { name: "Guatemala", iso: "GT", code: "+502" },
  { name: "Guernsey", iso: "GG", code: "+44" },
  { name: "Guinea", iso: "GN", code: "+224" },
  { name: "Guinea-Bissau", iso: "GW", code: "+245" },
  { name: "Guyana", iso: "GY", code: "+592" },
  { name: "Haiti", iso: "HT", code: "+509" },
  { name: "Honduras", iso: "HN", code: "+504" },
  { name: "Hong Kong", iso: "HK", code: "+852" },
  { name: "Hungary", iso: "HU", code: "+36" },
  { name: "Iceland", iso: "IS", code: "+354" },
  { name: "India", iso: "IN", code: "+91" },
  { name: "Indonesia", iso: "ID", code: "+62" },
  { name: "Iran", iso: "IR", code: "+98" },
  { name: "Iraq", iso: "IQ", code: "+964" },
  { name: "Ireland", iso: "IE", code: "+353" },
  { name: "Isle of Man", iso: "IM", code: "+44" },
  { name: "Israel", iso: "IL", code: "+972" },
  { name: "Italy", iso: "IT", code: "+39" },
  { name: "Jamaica", iso: "JM", code: "+1876" },
  { name: "Japan", iso: "JP", code: "+81" },
  { name: "Jersey", iso: "JE", code: "+44" },
  { name: "Jordan", iso: "JO", code: "+962" },
  { name: "Kazakhstan", iso: "KZ", code: "+7" },
  { name: "Kenya", iso: "KE", code: "+254" },
  { name: "Kiribati", iso: "KI", code: "+686" },
  { name: "Kosovo", iso: "XK", code: "+383" },
  { name: "Kuwait", iso: "KW", code: "+965" },
  { name: "Kyrgyzstan", iso: "KG", code: "+996" },
  { name: "Laos", iso: "LA", code: "+856" },
  { name: "Latvia", iso: "LV", code: "+371" },
  { name: "Lebanon", iso: "LB", code: "+961" },
  { name: "Lesotho", iso: "LS", code: "+266" },
  { name: "Liberia", iso: "LR", code: "+231" },
  { name: "Libya", iso: "LY", code: "+218" },
  { name: "Liechtenstein", iso: "LI", code: "+423" },
  { name: "Lithuania", iso: "LT", code: "+370" },
  { name: "Luxembourg", iso: "LU", code: "+352" },
  { name: "Macau", iso: "MO", code: "+853" },
  { name: "Madagascar", iso: "MG", code: "+261" },
  { name: "Malawi", iso: "MW", code: "+265" },
  { name: "Malaysia", iso: "MY", code: "+60" },
  { name: "Maldives", iso: "MV", code: "+960" },
  { name: "Mali", iso: "ML", code: "+223" },
  { name: "Malta", iso: "MT", code: "+356" },
  { name: "Marshall Islands", iso: "MH", code: "+692" },
  { name: "Martinique", iso: "MQ", code: "+596" },
  { name: "Mauritania", iso: "MR", code: "+222" },
  { name: "Mauritius", iso: "MU", code: "+230" },
  { name: "Mayotte", iso: "YT", code: "+262" },
  { name: "Mexico", iso: "MX", code: "+52" },
  { name: "Micronesia", iso: "FM", code: "+691" },
  { name: "Moldova", iso: "MD", code: "+373" },
  { name: "Monaco", iso: "MC", code: "+377" },
  { name: "Mongolia", iso: "MN", code: "+976" },
  { name: "Montenegro", iso: "ME", code: "+382" },
  { name: "Montserrat", iso: "MS", code: "+1664" },
  { name: "Morocco", iso: "MA", code: "+212" },
  { name: "Mozambique", iso: "MZ", code: "+258" },
  { name: "Myanmar", iso: "MM", code: "+95" },
  { name: "Namibia", iso: "NA", code: "+264" },
  { name: "Nauru", iso: "NR", code: "+674" },
  { name: "Nepal", iso: "NP", code: "+977" },
  { name: "Netherlands", iso: "NL", code: "+31" },
  { name: "New Caledonia", iso: "NC", code: "+687" },
  { name: "New Zealand", iso: "NZ", code: "+64" },
  { name: "Nicaragua", iso: "NI", code: "+505" },
  { name: "Niger", iso: "NE", code: "+227" },
  { name: "Nigeria", iso: "NG", code: "+234" },
  { name: "Niue", iso: "NU", code: "+683" },
  { name: "Norfolk Island", iso: "NF", code: "+672" },
  { name: "North Korea", iso: "KP", code: "+850" },
  { name: "North Macedonia", iso: "MK", code: "+389" },
  { name: "Northern Mariana Islands", iso: "MP", code: "+1670" },
  { name: "Norway", iso: "NO", code: "+47" },
  { name: "Oman", iso: "OM", code: "+968" },
  { name: "Pakistan", iso: "PK", code: "+92" },
  { name: "Palau", iso: "PW", code: "+680" },
  { name: "Palestine", iso: "PS", code: "+970" },
  { name: "Panama", iso: "PA", code: "+507" },
  { name: "Papua New Guinea", iso: "PG", code: "+675" },
  { name: "Paraguay", iso: "PY", code: "+595" },
  { name: "Peru", iso: "PE", code: "+51" },
  { name: "Philippines", iso: "PH", code: "+63" },
  { name: "Poland", iso: "PL", code: "+48" },
  { name: "Portugal", iso: "PT", code: "+351" },
  { name: "Puerto Rico", iso: "PR", code: "+1787" },
  { name: "Qatar", iso: "QA", code: "+974" },
  { name: "Réunion", iso: "RE", code: "+262" },
  { name: "Romania", iso: "RO", code: "+40" },
  { name: "Russia", iso: "RU", code: "+7" },
  { name: "Rwanda", iso: "RW", code: "+250" },
  { name: "Saint Barthélemy", iso: "BL", code: "+590" },
  { name: "Saint Helena", iso: "SH", code: "+290" },
  { name: "Saint Kitts and Nevis", iso: "KN", code: "+1869" },
  { name: "Saint Lucia", iso: "LC", code: "+1758" },
  { name: "Saint Martin", iso: "MF", code: "+590" },
  { name: "Saint Pierre and Miquelon", iso: "PM", code: "+508" },
  { name: "Saint Vincent and the Grenadines", iso: "VC", code: "+1784" },
  { name: "Samoa", iso: "WS", code: "+685" },
  { name: "San Marino", iso: "SM", code: "+378" },
  { name: "São Tomé and Príncipe", iso: "ST", code: "+239" },
  { name: "Saudi Arabia", iso: "SA", code: "+966" },
  { name: "Senegal", iso: "SN", code: "+221" },
  { name: "Serbia", iso: "RS", code: "+381" },
  { name: "Seychelles", iso: "SC", code: "+248" },
  { name: "Sierra Leone", iso: "SL", code: "+232" },
  { name: "Singapore", iso: "SG", code: "+65" },
  { name: "Sint Maarten", iso: "SX", code: "+1721" },
  { name: "Slovakia", iso: "SK", code: "+421" },
  { name: "Slovenia", iso: "SI", code: "+386" },
  { name: "Solomon Islands", iso: "SB", code: "+677" },
  { name: "Somalia", iso: "SO", code: "+252" },
  { name: "South Africa", iso: "ZA", code: "+27" },
  { name: "South Korea", iso: "KR", code: "+82" },
  { name: "South Sudan", iso: "SS", code: "+211" },
  { name: "Spain", iso: "ES", code: "+34" },
  { name: "Sri Lanka", iso: "LK", code: "+94" },
  { name: "Sudan", iso: "SD", code: "+249" },
  { name: "Suriname", iso: "SR", code: "+597" },
  { name: "Sweden", iso: "SE", code: "+46" },
  { name: "Switzerland", iso: "CH", code: "+41" },
  { name: "Syria", iso: "SY", code: "+963" },
  { name: "Taiwan", iso: "TW", code: "+886" },
  { name: "Tajikistan", iso: "TJ", code: "+992" },
  { name: "Tanzania", iso: "TZ", code: "+255" },
  { name: "Thailand", iso: "TH", code: "+66" },
  { name: "Timor-Leste", iso: "TL", code: "+670" },
  { name: "Togo", iso: "TG", code: "+228" },
  { name: "Tonga", iso: "TO", code: "+676" },
  { name: "Trinidad and Tobago", iso: "TT", code: "+1868" },
  { name: "Tunisia", iso: "TN", code: "+216" },
  { name: "Turkey", iso: "TR", code: "+90" },
  { name: "Turkmenistan", iso: "TM", code: "+993" },
  { name: "Turks and Caicos Islands", iso: "TC", code: "+1649" },
  { name: "Tuvalu", iso: "TV", code: "+688" },
  { name: "Uganda", iso: "UG", code: "+256" },
  { name: "Ukraine", iso: "UA", code: "+380" },
  { name: "United Arab Emirates", iso: "AE", code: "+971" },
  { name: "United Kingdom", iso: "GB", code: "+44" },
  { name: "United States", iso: "US", code: "+1" },
  { name: "Uruguay", iso: "UY", code: "+598" },
  { name: "US Virgin Islands", iso: "VI", code: "+1340" },
  { name: "Uzbekistan", iso: "UZ", code: "+998" },
  { name: "Vanuatu", iso: "VU", code: "+678" },
  { name: "Vatican City", iso: "VA", code: "+379" },
  { name: "Venezuela", iso: "VE", code: "+58" },
  { name: "Vietnam", iso: "VN", code: "+84" },
  { name: "Wallis and Futuna", iso: "WF", code: "+681" },
  { name: "Western Sahara", iso: "EH", code: "+212" },
  { name: "Yemen", iso: "YE", code: "+967" },
  { name: "Zambia", iso: "ZM", code: "+260" },
  { name: "Zimbabwe", iso: "ZW", code: "+263" },
];

/** Dial codes longest-first, so "+1876" wins over "+1" when parsing a value. */
export const CODES_BY_LENGTH: string[] = Array.from(
  new Set(DIAL_CODES.map((d) => d.code))
).sort((a, b) => b.length - a.length);

/**
 * Nine dial codes are shared by more than one country. Only the code is stored
 * with a number, so labelling a parsed value needs a tie-break — without one,
 * first-alphabetically wins and a UK number renders as "GG" (Guernsey), a US
 * one as "CA", and a Russian one as "KZ". These pick the country a reader
 * would expect for each shared code.
 */
const PRIMARY_ISO_FOR_CODE: Record<string, string> = {
  "+1": "US",    // vs Canada
  "+7": "RU",    // vs Kazakhstan
  "+44": "GB",   // vs Guernsey / Isle of Man / Jersey
  "+61": "AU",   // vs Christmas / Cocos Islands
  "+212": "MA",  // vs Western Sahara
  "+262": "RE",  // vs Mayotte
  "+358": "FI",  // vs Åland Islands
  "+590": "GP",  // vs Saint Barthélemy / Saint Martin
  "+599": "CW",  // vs Bonaire, Sint Eustatius and Saba
};

/** The country to display for a dial code parsed out of a stored number. */
export function countryForCode(code: string): DialCode | undefined {
  const primary = PRIMARY_ISO_FOR_CODE[code];
  if (primary) {
    const hit = DIAL_CODES.find((d) => d.iso === primary);
    if (hit) return hit;
  }
  return DIAL_CODES.find((d) => d.code === code);
}
