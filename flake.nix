{
  description = "local-paas Linux development and installation tools";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { nixpkgs, ... }: let
    systems = [ "x86_64-linux" "aarch64-linux" ];
    each = nixpkgs.lib.genAttrs systems;
    tools = pkgs: with pkgs; [
      bash coreutils curl git nix gnumake gnugrep gnused gawk findutils
      rustc cargo rustfmt clippy gcc pkg-config nodejs_24 pnpm postgresql_18
      openssl caddy stunnel nftables cdrkit util-linux systemd
    ];
  in {
    packages = each (system: let pkgs = import nixpkgs { inherit system; }; in {
      quality-tools = pkgs.symlinkJoin { name = "local-paas-quality-tools"; paths = with pkgs; [ cargo-nextest cargo-audit cargo-deny gitleaks sqlx-cli ]; };
      browser-test-tools = pkgs.symlinkJoin { name = "local-paas-browser-test-tools"; paths = [ pkgs.openbao ]; };
      remote-test-tools = pkgs.symlinkJoin { name = "local-paas-remote-test-tools"; paths = with pkgs; [ stunnel caddy openssl cdrkit ]; };
      default = pkgs.symlinkJoin { name = "local-paas-host-tools"; paths = tools pkgs; };
    });
    devShells = each (system: let pkgs = import nixpkgs { inherit system; }; in {
      default = pkgs.mkShell { packages = tools pkgs; };
    });
  };
}
