import { BaseConnector } from '../base.js';
import { EvidenceType, SourceTrust } from '../../core/schema.js';

class OpenFDAConnector extends BaseConnector {
  constructor() {
    super({
      id: 'openfda',
      name: 'OpenFDA',
      description: 'FDA adverse events, drug enforcement actions, recalls, warning letters, device complaints',
      baseUrl: 'https://api.fda.gov',
      domains: ['health', 'legal', 'corporate', 'compliance'],
      trustTier: SourceTrust.GOVERNMENT_FILING,
      rateMs: 1200,
    });
  }

  async search(query, options = {}) {
    try {
      const limit = Math.min(options.limit || 10, 25);
      const results = [];

      // Search drug enforcement actions (recalls, market withdrawals)
      const enfUrl = `${this.baseUrl}/drug/enforcement.json?search=${encodeURIComponent(query)}&limit=${limit}`;
      const enfRes = await this._fetch(enfUrl);
      if (enfRes.ok && enfRes.data?.results) {
        for (const r of enfRes.data.results) {
          results.push({
            url: r.openfda?.brand_name?.[0]
              ? `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts`
              : `https://api.fda.gov/drug/enforcement.json`,
            title: `FDA Enforcement: ${r.reason_for_recall || r.product_description || 'Unknown'}`.slice(0, 200),
            summary: [
              r.reason_for_recall,
              r.product_description && `Product: ${r.product_description}`,
              r.recalling_firm && `Firm: ${r.recalling_firm}`,
              r.classification && `Class ${r.classification}`,
              r.status && `Status: ${r.status}`,
              r.distribution_pattern && `Distribution: ${r.distribution_pattern}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: r.report_date || r.recall_initiation_date || null,
            data: {
              source: 'drug_enforcement',
              classification: r.classification,
              status: r.status,
              firm: r.recalling_firm,
              city: r.city,
              state: r.state,
              country: r.country,
              voluntaryMandated: r.voluntary_mandated,
              productType: r.product_type,
            },
          });
        }
      }

      // Search adverse events (FAERS) — drug safety signals
      const aeUrl = `${this.baseUrl}/drug/event.json?search=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`;
      const aeRes = await this._fetch(aeUrl);
      if (aeRes.ok && aeRes.data?.results) {
        for (const r of aeRes.data.results) {
          const drugs = (r.patient?.drug || []).map(d => d.medicinalproduct).filter(Boolean);
          const reactions = (r.patient?.reaction || []).map(rx => rx.reactionmeddrapt).filter(Boolean);
          if (drugs.length === 0 && reactions.length === 0) continue;
          results.push({
            url: `https://www.fda.gov/drugs/questions-and-answers-fdas-adverse-event-reporting-system-faers`,
            title: `FDA Adverse Event: ${drugs.slice(0, 3).join(', ') || 'Unknown drug'}`,
            summary: [
              drugs.length && `Drugs: ${drugs.slice(0, 5).join(', ')}`,
              reactions.length && `Reactions: ${reactions.slice(0, 5).join(', ')}`,
              r.serious && `Serious: ${r.serious === '1' ? 'Yes' : 'No'}`,
              r.seriousnessdeath === '1' && 'DEATH REPORTED',
              r.seriousnesshospitalization === '1' && 'Hospitalization',
              r.receivedate && `Reported: ${r.receivedate}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: r.receivedate
              ? `${r.receivedate.slice(0, 4)}-${r.receivedate.slice(4, 6)}-${r.receivedate.slice(6, 8)}`
              : null,
            data: {
              source: 'drug_adverse_event',
              serious: r.serious === '1',
              death: r.seriousnessdeath === '1',
              hospitalization: r.seriousnesshospitalization === '1',
              drugs,
              reactions,
              reporterCountry: r.primarysource?.reportercountry,
            },
          });
        }
      }

      // Search device recalls
      const devUrl = `${this.baseUrl}/device/enforcement.json?search=${encodeURIComponent(query)}&limit=${Math.min(limit, 10)}`;
      const devRes = await this._fetch(devUrl);
      if (devRes.ok && devRes.data?.results) {
        for (const r of devRes.data.results) {
          results.push({
            url: `https://www.fda.gov/medical-devices/medical-device-recalls`,
            title: `FDA Device Recall: ${r.product_description || r.reason_for_recall || 'Unknown'}`.slice(0, 200),
            summary: [
              r.reason_for_recall,
              r.product_description && `Device: ${r.product_description}`,
              r.recalling_firm && `Firm: ${r.recalling_firm}`,
              r.classification && `Class ${r.classification}`,
            ].filter(Boolean).join('. ').slice(0, 500),
            type: EvidenceType.NEUTRAL,
            timestamp: r.report_date || r.recall_initiation_date || null,
            data: {
              source: 'device_enforcement',
              classification: r.classification,
              firm: r.recalling_firm,
              status: r.status,
            },
          });
        }
      }

      return this._toEvidence(results.slice(0, limit * 2), options.claimId);
    } catch {
      return [];
    }
  }
}

export default OpenFDAConnector;
