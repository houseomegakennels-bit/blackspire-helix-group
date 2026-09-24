// Runtime acceptance uses the existing authenticated Command operator and tenant.
// The root release coordinator's journal identity is deliberately separate.
// Collector host validation still proves the protected process bearer identity,
// live grants, task ownership and receiver authority; these names are not proof.
export const PRODUCTION_ACCEPTANCE_WORKSPACE='blackspire-command';
export const PRODUCTION_ACCEPTANCE_PRINCIPAL='blackspire-operator';
export function isProductionAcceptanceIdentity(value){
 return value?.workspace===PRODUCTION_ACCEPTANCE_WORKSPACE
  &&value?.principal===PRODUCTION_ACCEPTANCE_PRINCIPAL;
}
