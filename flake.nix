{
  description = "Template for Holochain app development";

  inputs = {
    holonix.url = "github:holochain/holonix/main-0.5";

    nixpkgs.follows = "holonix/nixpkgs";
    flake-parts.follows = "holonix/flake-parts";
  };

  outputs = inputs@{ flake-parts, ... }: flake-parts.lib.mkFlake { inherit inputs; } {
    systems = builtins.attrNames inputs.holonix.devShells;
    perSystem = { inputs', pkgs, ... }: {
      formatter = pkgs.nixpkgs-fmt;

      devShells.default = pkgs.mkShell {
        packages = (with inputs'.holonix.packages; [
          holochain
          hc
          hcterm
          bootstrap-srv
          lair-keystore
          hc-launch
          hc-scaffold
          hn-introspect
          hc-playground
          rust
        ]) ++ (with pkgs; [
          nodejs_20 # For UI development
          binaryen # For WASM optimisation
          wasm-strip
        ]);

        shellHook = ''
          export PS1='\[\033[1;34m\][holonix:\w]\$\[\033[0m\] '
        '';
      };
    };
  };
}
