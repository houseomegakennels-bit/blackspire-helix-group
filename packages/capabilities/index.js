import { createCapabilityRegistry } from './registry.js';
import { sellerOpportunityCapability } from './seller-opportunities.js';
import { buyerProfilesCapability } from './buyer-profiles.js';
import { buyerMatchesCapability } from './buyer-matches.js';

export const blackspireCapabilityRegistry = createCapabilityRegistry([sellerOpportunityCapability, buyerProfilesCapability, buyerMatchesCapability]);
