{
  description = "Disposable local-paas builder; no NAS or host store shares";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      guest = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [ ./vm.nix ];
      };
    in {
      packages.${system} = {
        default = guest.config.system.build.vm;
        tools = pkgs.symlinkJoin {
          name = "local-paas-builder-tools";
          paths = with pkgs; [ buildkit git nftables openssl cdrkit qemu_kvm ];
        };
      };
    };
}
