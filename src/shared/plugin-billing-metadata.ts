/** Billing is host-owned: code registrations and stored v1 contracts share the same checks. */
export function validatePluginBillingMetadata(
  annotations: Record<string, unknown>,
  issue: (path: string[], message: string) => void,
) {
  const settlement = annotations['billing.settlement'];
  const relayTemplate = annotations['billing.relay_template'];
  const billingProduct = annotations['billing.product'];
  if (settlement !== undefined && settlement !== 'cloud_relay' && settlement !== 'local_relay') {
    issue(['annotations', 'billing.settlement'], '不支持的计费结算方式。');
  }
  if (settlement !== undefined && annotations['billing.exempt'] === true) {
    issue(['annotations'], '云转发结算方法不能同时声明计费豁免。');
  }
  if (annotations['billing.mode'] !== undefined) issue(['annotations', 'billing.mode'], '插件不能声明计费模式。');
  if (settlement === 'cloud_relay' && (typeof relayTemplate !== 'string' || typeof billingProduct !== 'string')) {
    issue(['annotations'], '云转发方法必须声明转发模板和计费产品。');
  }
  if (settlement === 'local_relay' && typeof billingProduct !== 'string')
    issue(['annotations'], '本地结算方法必须声明计费产品。');
  if (
    (settlement !== 'cloud_relay' && relayTemplate !== undefined) ||
    (settlement !== 'cloud_relay' && settlement !== 'local_relay' && billingProduct !== undefined)
  ) {
    issue(['annotations'], '计费产品需要声明结算方式，转发模板只能用于云转发。');
  }
}
