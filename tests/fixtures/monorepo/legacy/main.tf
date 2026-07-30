# .tf variant; the .tofu file with the same basename takes precedence.
terraform {
  backend "s3" {
    bucket = "legacy"
  }
}
