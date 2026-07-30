# A .tf file inside .github must never be detected (default exclude).
resource "null_resource" "hidden" {}
