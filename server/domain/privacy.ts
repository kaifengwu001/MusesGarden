// The allow-list's last line: interest labels from MEMORY.md and SOUL.md pass only if nothing about them
// looks like a person, health, money, a relationship, a place or an identifier. A false drop is fine; a leak
// is not, so every rule errs toward dropping.

const words = (list: string): ReadonlySet<string> => new Set(list.trim().split(/\s+/));

const FIRST_NAMES = words(`
  aaron adam adrian aisha alex alexander alice amanda amelia amir amy ana andrea andrew angela anna anne anthony
  aria arjun ava ben benjamin beth brandon brian carlos carmen caroline charles charlotte chen chloe chris
  christina christopher claire daniel david deepa diana diego dylan elena eli elijah elizabeth ella emily emma eric
  ethan eva evan fatima felix fiona frank gabriel george grace hannah harper harry hassan henry hiroshi ian isaac
  isabella jack jacob james jamie jane jason jennifer jessica jin john jonathan jordan jose joseph joshua julia
  julian justin karen kate katherine kevin kim laura lauren leah leo liam lily linda lisa lucas lucy luis luna
  maria mark marcus mary mason matthew maya mei mia michael michelle miguel mohammed muhammad nadia naomi natalie
  nathan nicole noah nora oliver olivia omar owen patel patrick paul peter priya rachel rahul raj rebecca richard
  robert rosa ryan sam samantha samuel sara sarah sean sebastian sofia sophia sophie stephanie steven susan taylor
  thomas tim timothy tom tyler victoria wei william yuki zoe zoey
`);

/** Common surnames, so a lone family name ("Webb") is caught too. Ones that are everyday words (Green, Hill) are left out. */
const SURNAMES = words(`
  smith johnson williams jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson
  anderson thomas taylor moore jackson martin lee perez thompson harris sanchez clark ramirez lewis robinson
  walker allen wright scott torres nguyen flores adams nelson rivera campbell
  mitchell carter roberts gomez phillips evans turner diaz parker edwards collins stewart morris morales
  murphy rogers gutierrez ortiz morgan cooper peterson bailey kelly howard ramos richardson
  watson brooks chavez james bennett mendoza ruiz hughes alvarez castillo sanders patel myers
  ross foster jimenez powell jenkins perry russell sullivan coleman butler henderson barnes fisher webb
  palmer graham wallace ellis murray hamilton gibson
  wang li zhang liu yang huang zhao wu zhou xu zhu hu guo lin gao luo zheng ng lim chan wong
  kim choi jung kang cho yoon jang lim han
  shah singh kumar sharma gupta khan ali ahmed hussain iyer reddy rao nair das bose
  nakamura tanaka suzuki takahashi watanabe ito yamamoto kobayashi sato
  muller schmidt schneider fischer weber meyer wagner becker schulz hoffmann rossi russo ferrari esposito bianchi
  dubois durand lefebvre moreau laurent silva santos oliveira souza costa pereira
`);

const PEOPLE = words(`
  mr mrs ms miss dr prof sir madam aunt auntie uncle grandma grandpa granny nana
  wife husband spouse partner boyfriend girlfriend fiance fiancé fiancee fiancée ex divorce divorced separated
  married marriage wedding dating breakup affair crush son sons daughter daughters kid kids child children baby
  babies mother mom mum mommy father dad daddy parent parents sister sisters brother brothers sibling siblings
  cousin cousins niece nephew grandmother grandfather grandson granddaughter in-law in-laws family friend friends
  roommate roommates boss coworker coworkers colleague colleagues manager neighbor neighbour
`);

const HEALTH = words(`
  diagnosis diagnosed disease diseases disorder disorders syndrome condition cancer tumor tumour diabetes diabetic
  depression depressed anxiety adhd autism autistic asthma allergy allergies allergic pregnant pregnancy miscarriage
  ivf fertility infertility therapy therapist medication medications meds prescription surgery illness ill sick
  chronic migraine migraines hiv aids covid injury injured insulin hospital hospitalized clinic doctor psychiatrist
  bipolar schizophrenia ocd ptsd epilepsy seizure seizures arthritis celiac coeliac ibs crohn crohn's lupus dementia
  alzheimer alzheimer's parkinson parkinson's rehab addiction addicted sober sobriety alcoholism alcoholic anorexia
  bulimia diet dieting cholesterol stroke disability disabled wheelchair deaf blind symptoms symptom treatment
  chemo chemotherapy radiation transplant vaccine vaccinated std sti hypertension obesity overweight insomnia
  mental psychiatric takes taking prescribed dose dosage mg health medical glucose tablets pills inhaler
`);

/** Common drug-name endings: medications are too many to list. */
const DRUG = /(formin|statin|pril|olol|sartan|azole|cillin|mycin|oxetine|azepam|zolam|profen|tidine|lukast|triptan|xaban|gliptin|glutide)\b/i;

const MONEY = words(`
  salary salaries income wage wages pay paid paycheck payroll bonus raise earn earns earning earnings debt debts
  loan loans mortgage rent bank banking account accounts credit savings invest investing investment investments
  stock stocks crypto bitcoin pension tax taxes budget bills broke money finances financial inheritance alimony
  compensation equity rsu rsus usd eur gbp employer job jobs company startup
`);

const PLACES = words(`
  street st avenue ave road rd boulevard blvd lane ln drive court ct apt apartment suite zip zipcode postcode
  address lives living moved hometown neighborhood neighbourhood city town village county state country condo
  san francisco york nyc los angeles seattle portland boston chicago austin denver miami atlanta dallas houston
  phoenix philadelphia brooklyn manhattan oakland berkeley london paris berlin tokyo osaka kyoto beijing shanghai
  shenzhen hong kong singapore mumbai delhi bangalore toronto vancouver montreal sydney melbourne auckland dublin
  madrid barcelona rome milan amsterdam lisbon vienna prague stockholm oslo copenhagen seoul taipei bangkok jakarta
  manila cairo lagos nairobi johannesburg dubai istanbul moscow mexico rio sao lima bogota buenos aires
  usa america united states canada uk england scotland wales ireland france germany spain italy portugal
  netherlands sweden norway denmark finland japan china india korea taiwan vietnam thailand indonesia philippines
  australia zealand brazil argentina chile peru colombia egypt nigeria kenya russia ukraine poland turkey israel
  california texas oregon washington florida massachusetts illinois colorado arizona georgia virginia carolina
  ohio michigan minnesota utah nevada hawaii alaska
`);

const CONNECTORS = words('of the and de la le du van von da del di bin al y');

const IDENTIFIER = /[0-9@#$€£¥%]|https?:|www\.|\.(com|org|net|io)\b/i;
const POSSESSIVE = /['’]s\b/i;
const FIRST_PERSON = words('i me my mine we us our ours');
const MAX_WORDS = 6;

function tokens(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[\s,;:/()"“”]+/)
    .map((w) => w.replace(/^[-'’.]+|[-'’.]+$/g, ''))
    .filter((w) => w.length > 0);
}

/** Two or more words, every one of them capitalized: a person's name, a company, a place. */
function looksProper(label: string): boolean {
  const ws = label.split(/\s+/).filter((w) => w.length > 0 && !CONNECTORS.has(w.toLowerCase()));
  return ws.length >= 2 && ws.every((w) => /^[A-Z]/.test(w));
}

const sensitiveWord = (w: string): boolean =>
  FIRST_NAMES.has(w) || SURNAMES.has(w) || PEOPLE.has(w) || HEALTH.has(w) || MONEY.has(w) || PLACES.has(w) || FIRST_PERSON.has(w);

function sensitive(label: string): boolean {
  if (IDENTIFIER.test(label) || POSSESSIVE.test(label) || DRUG.test(label) || looksProper(label)) return true;
  const ts = tokens(label);
  return ts.length === 0 || ts.length > MAX_WORDS || ts.some(sensitiveWord);
}

/** Allow-listed MEMORY.md/SOUL.md labels: drops anything that looks like a person, health, money, place or identifier. */
export function privacyFilter(labels: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (!sensitive(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

const STOPWORDS = words('a an the of and or to in on at by for with from is are was were be been this that these those it its as into who while during');

/** Content words cut to five letters, so "tablet" finds "tablets". */
const stems = (text: string): string[] => tokens(text).filter((w) => !STOPWORDS.has(w)).map((w) => w.slice(0, 5));

/**
 * A line that names someone or something (a capital word after a sentence's first), or that has an identifier
 * or a sensitive word. A lone "Dana" or "Springfield" looks just like "Jazz" as a label; only its line gives it away.
 */
function sensitiveLine(line: string): boolean {
  const body = line.replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s*/, '');
  if (IDENTIFIER.test(body) || POSSESSIVE.test(body) || DRUG.test(body) || tokens(body).some(sensitiveWord)) return true;
  return body.split(/[.!?;:]\s+/).some((sentence) =>
    sentence
      .trim()
      .split(/\s+/)
      .slice(1)
      .some((w) => /^[A-Z]/.test(w) && w !== 'I'),
  );
}

/**
 * privacyFilter, plus the document the labels came from: a label is also dropped when every one of its words
 * appears on a line that names a person or place or carries a private fact.
 */
export function privacyFilterIn(labels: readonly string[], text: string): readonly string[] {
  const flagged = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .filter(sensitiveLine)
    .map((line) => new Set(stems(line)));
  return privacyFilter(labels).filter((label) => {
    const st = stems(label);
    return st.length > 0 && !flagged.some((line) => st.every((x) => line.has(x)));
  });
}
