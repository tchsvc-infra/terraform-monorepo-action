terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "state-bucket"
    key    = "vpc/terraform.tfstate"
  }
}

module "network" {
  source     = "../../modules/network"
  cidr_block = "10.0.0.0/16"
}
