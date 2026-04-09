import { ReportGenerator } from './src/report/generator.js';

const g = new ReportGenerator();

const inv = {
  query: 'Is Iran developing nuclear weapons in 2025?',
  status: 'contested',
  confidence: 0.523,
  evidence: [
    { id: 1, connectorId: 'wikipedia', type: 'supports', trustWeight: 0.65, summary: "Despite the end of Iran's covert nuclear weapons program in 2003, fears that Iran is moving closer to developing nuclear weapons have led to rising tensions between Iran, the US and Israel." },
    { id: 2, connectorId: 'guardian', type: 'supports', trustWeight: 0.65, summary: "Tehran insists deal is possible if US president abides by preconditions agreed with Witkoff and Kushner. Iran and US begin indirect nuclear negotiations." },
    { id: 3, connectorId: 'federal_register', type: 'contextual', trustWeight: 0.95, summary: "The U.S. Department of Energy is amending its Record of Decision for the Disposition of Surplus Highly Enriched Uranium." },
    { id: 4, connectorId: 'crossref', type: 'supports', trustWeight: 0.80, summary: "Iran is developing triggers for nuclear weapons, says IAEA (2011)" },
    { id: 5, connectorId: 'reddit', type: 'supports', trustWeight: 0.30, summary: "Carney: Iran's nuclear programme is a grave threat to international security, and Canada has been consistently clear that Iran can never be allowed to develop a nuclear weapon." },
    { id: 6, connectorId: 'courtlistener', type: 'contextual', trustWeight: 0.90, summary: "Ellison v. Islamic Republic of Iran — Court: District Court, District of Columbia — Filed: 2025-07-22" },
    { id: 7, connectorId: 'wikipedia', type: 'contradicts', trustWeight: 0.65, summary: "The Supreme Leader's fatwa against nuclear weapons dates back to the mid-1990s. Iran has consistently denied pursuing nuclear weapons." },
    { id: 8, connectorId: 'rss_news', type: 'contradicts', trustWeight: 0.65, summary: "Report indicates that US intelligence officials question effectiveness of strikes to produce regime change in Iran." },
    { id: 9, connectorId: 'wikipedia', type: 'supports', trustWeight: 0.65, summary: "During their Twelve-Day War in June 2025, which also saw a US airstrike on Iran's nuclear facilities, raising questions about Iran's nuclear capabilities." },
    // GARBAGE — should NOT appear:
    { id: 10, connectorId: 'pubmed', type: 'neutral', trustWeight: 0.80, summary: "Developing and Determining Psychometric Properties of the Family Intensive Care Unit Syndrome Scale." },
    { id: 11, connectorId: 'openalex', type: 'neutral', trustWeight: 0.80, summary: "Factors Affecting the Lut Desert Tourism in Iran: Developing an Interpretive-Structural Model" },
    { id: 12, connectorId: 'government', type: 'contextual', trustWeight: 0.95, summary: "Prognostics is an emerging concept in condition based maintenance of critical systems." },
    { id: 13, connectorId: 'wikipedia', type: 'supports', trustWeight: 0.65, summary: "China's stockpile of nuclear weapons is estimated at 600 nuclear warheads as of 2025." },
  ],
  synthesis: {
    stanceBreakdown: { supports: 31, contradicts: 16, contextual: 73, neutral: 72 },
    overallDirection: 'contested',
    themes: [{ name: 'Nuclear program and IAEA', evidenceCount: 45, topSources: ['wikipedia', 'guardian', 'rss_news'] }],
    summary: 'Evidence is divided on whether Iran is actively developing nuclear weapons.',
    llm: {
      synthesis: "The evidence presents a complex picture. While Iran has enriched uranium to levels far beyond civilian needs (60% at Fordow), the IAEA has not detected diversion to a weapons program. Multiple sources confirm ongoing diplomatic tensions and military strikes on Iranian nuclear facilities in 2025, but the intelligence community remains divided on whether enrichment constitutes active weapons development.",
      patterns: [
        "Independent sources (IAEA, news, court records) converge on the fact that Iran's nuclear program has expanded significantly since 2023",
        "A temporal cluster of legal actions against Iran in US courts in 2025 suggests escalating tensions",
        "No primary intelligence documents are available in the evidence set — conclusions rely on secondary reporting",
      ],
      missingAngles: [
        "No satellite imagery analysis of nuclear sites",
        "No IAEA safeguards reports available through current connectors",
        "Missing perspective from Iranian government officials and state media",
      ],
      credibilityNotes: "Government sources (Federal Register, court records) are highest credibility but mostly tangential. Wikipedia and major news provide the most topically relevant evidence but are secondary sources.",
    },
  },
  _gateResult: { passed: true },
  meta: { sourcesQueried: 40, sourcesResponded: 21, sourcesFailed: 19, wallTimeMs: 628500, evidenceDropped: 161 },
  redTeamBrief: {
    strength: 0.42,
    arguments: [
      { counterHypothesis: "Iran's enrichment program may be a civilian energy and medical isotope program that has been mischaracterized by hostile intelligence agencies", score: 0.55, supportingEvidence: [{}, {}, {}], reasoning: "Iran has consistently maintained its nuclear program is peaceful, and the IAEA has not found evidence of diversion." },
      { counterHypothesis: "The intelligence community has a documented history of overestimating nuclear weapons capability, as demonstrated by the 2003 Iraq WMD failure", score: 0.42, supportingEvidence: [{}, {}], reasoning: "The Iraq precedent significantly undermines confidence in nuclear weapons claims based on secondary intelligence." },
    ],
    summary: "Two counter-arguments warrant attention. The strongest challenges the assessment of enrichment as weapons-directed.",
  },
  vectors: { know: 1.0, coverage: 0.525, diversity: 0.766, freshness: 1.0, coherence: 1.0, convergence: 0.914, falsifiability: 0.0, uncertainty: 0.31, fragility: 0.231, blindspots: 0.322, velocity: 0.654, attackSurvival: 0.359 },
  coverageGaps: { gaps: [{ description: "No IAEA safeguards reports or primary intelligence documents" }, { description: "Missing Iranian state media perspective" }] },
  nullFindings: [{ expectedSource: 'ofac', severity: 0.8, interpretation: "OFAC returned no sanctions data for Iran nuclear entities — may be queried under different entity names" }],
};

console.log(g.generate(inv));
