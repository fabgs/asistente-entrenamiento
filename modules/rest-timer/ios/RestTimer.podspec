Pod::Spec.new do |s|
  s.name           = 'RestTimer'
  s.version        = '1.0.0'
  s.summary        = 'Funciones nativas de Entreno'
  s.description    = 'Funciones nativas de Entreno en iOS: la clave de las copias cifradas.'
  s.author         = ''
  s.homepage       = 'https://github.com/fabgs/asistente-entrenamiento'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
