{
  description = "Pinned local-paas log and secret services";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { nixpkgs, ... }: let pkgs = import nixpkgs { system = "x86_64-linux"; }; in {
    packages.x86_64-linux.default = pkgs.symlinkJoin {
      name = "local-paas-services";
      paths = [ pkgs.clickhouse pkgs.openbao pkgs.restic pkgs.redis pkgs.bubblewrap ];
    };
  };
}
