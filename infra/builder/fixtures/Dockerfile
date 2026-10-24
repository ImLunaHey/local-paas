# syntax=invalid.invalid/untrusted-frontend:must-not-be-used
FROM busybox@sha256:5cec3fc171c87218698e85a52af7087de727372aae264a787b8112901a5b0092 AS isolation
RUN wget -T 15 -q -O /dev/null http://example.com/
# The host-side canary HTTP listener is reachable by the host operator.
# A successful request from a build must fail this test.
RUN if wget -T 3 -q -O /dev/null http://10.0.2.2:18089/; then exit 1; fi
RUN if wget -T 3 -q -O /dev/null http://100.64.0.1:5188/; then exit 1; fi
RUN if wget -T 3 -q -O /dev/null http://10.0.0.1/; then exit 1; fi
RUN test ! -e /run/builder-tls/key.pem && test ! -e /host && echo isolation-checks-passed
