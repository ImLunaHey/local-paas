{
  description = "Isolated local-paas development worker VMs";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  outputs = { nixpkgs, ... }: {
    packages = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (system:
    let
      pkgs = import nixpkgs { inherit system; };
      secretExec = pkgs.runCommand "local-paas-secret-exec" { nativeBuildInputs = [ pkgs.rustc pkgs.stdenv.cc pkgs.binutils ]; } ''
        mkdir -p $out/bin
        rustc --edition=2024 -L native=${pkgs.glibc.static}/lib -C target-feature=+crt-static -C opt-level=s ${./secret-exec.rs} -o $out/bin/secret-exec
        strip $out/bin/secret-exec
        if readelf -l $out/bin/secret-exec | grep -q INTERP; then exit 1; fi
      '';
      # build.sh copies the freshly built agent into a private staging flake.
      agent = pkgs.runCommand "local-paas-node-agent" { nativeBuildInputs = [ pkgs.binutils pkgs.patchelf ]; } ''
        mkdir -p $out/bin
        cp ${./node-agent-bin} $out/bin/node-agent
        chmod 755 $out/bin/node-agent
        strip $out/bin/node-agent
        patchelf --set-interpreter ${pkgs.stdenv.cc.bintools.dynamicLinker} --set-rpath ${pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.glibc ]} $out/bin/node-agent
        cp ${secretExec}/bin/secret-exec $out/bin/secret-exec
      '';
      worker = index: (nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit agent index; };
        modules = [ ./vm.nix ];
      }).config.system.build.vm;
    in {

        worker1 = worker 1;
        worker2 = worker 2;
        worker3 = worker 3;
        worker4 = worker 4;
        worker5 = worker 5;
        worker6 = worker 6;
        worker7 = worker 7;
        tools = pkgs.symlinkJoin {
          name = "local-paas-worker-tools";
          paths = with pkgs; [ caddy nftables openssl cdrkit qemu_kvm ];
        };
    });
  };
}
