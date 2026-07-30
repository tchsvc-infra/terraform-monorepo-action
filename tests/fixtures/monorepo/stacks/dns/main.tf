provider "aws" {
  region = "us-east-1"
}

module "network" {
  source = "../../modules/network"
}

# a comment with backend "fake" { that should be ignored
