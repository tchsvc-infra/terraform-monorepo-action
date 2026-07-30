terraform {
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.passphrase
    }
    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }
    state {
      method = method.aes_gcm.main
    }
  }
}
