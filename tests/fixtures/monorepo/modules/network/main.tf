variable "cidr_block" {
  type    = string
  default = "10.0.0.0/16"
}

output "vpc_id" {
  value = "vpc-123"
}
