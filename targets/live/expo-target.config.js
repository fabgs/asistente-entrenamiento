/**
 * The widget extension of the Live Activity (1.5.7), added to the iOS project by @bacons/apple-targets
 * on prebuild. No App Group or other entitlement: SideStore has to sign it with a free Apple ID.
 */
module.exports = () => ({
  type: 'widget',
  name: 'EntrenoLive',
  displayName: 'Entreno',
  bundleIdentifier: '.live',
  deploymentTarget: '16.4',
});
