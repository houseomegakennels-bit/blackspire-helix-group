import { createCapabilityRegistry } from './registry.js';
import { sellerOpportunityCapability } from './seller-opportunities.js';

export const blackspireCapabilityRegistry = createCapabilityRegistry([sellerOpportunityCapability]);
