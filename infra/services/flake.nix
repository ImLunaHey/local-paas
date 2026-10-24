{
  description = "Pinned dedicated log, secret and backup services";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { nixpkgs, ... }: {
    packages = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (system:
      let pkgs = import nixpkgs { inherit system; }; in {
        default = pkgs.symlinkJoin {
          name = "local-paas-services";
          paths = with pkgs; [ clickhouse openbao restic redis bubblewrap postgresql_18 coreutils gnutar ];
        };
      });
  };
}
