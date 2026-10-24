FROM rust:1.98.1-alpine@sha256:7cc1c22d77d9432f7fe012a70e6d3e555af54c2a6832700ed7d553f1769ae89f AS build
WORKDIR /src
COPY main.rs .
RUN rustc --edition=2024 -C opt-level=2 -C target-feature=+crt-static main.rs -o /canary
FROM scratch
COPY --from=build /canary /canary
USER 1000:1000
ENTRYPOINT ["/canary"]
