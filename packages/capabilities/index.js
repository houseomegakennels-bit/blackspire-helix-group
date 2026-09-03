import { createCapabilityRegistry } from './registry.js';
import { sellerOpportunityCapability } from './seller-opportunities.js';
import { buyerProfilesCapability } from './buyer-profiles.js';
import { buyerMatchesCapability } from './buyer-matches.js';
import { dealRecordsCapability } from './deal-records.js';
import { dealAnalysisCapability } from './deal-analysis.js';

export const blackspireCapabilityRegistry = createCapabilityRegistry([sellerOpportunityCapability, buyerProfilesCapability, buyerMatchesCapability, dealRecordsCapability, dealAnalysisCapability]);
