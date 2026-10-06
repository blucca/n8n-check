ARG N8N_VERSION=2.41.7
FROM ghcr.io/n8n-io/n8n:${N8N_VERSION}
USER root
COPY --chown=node:node bin /opt/n8n-check/bin
COPY --chown=node:node src /opt/n8n-check/src
COPY --chown=node:node examples /opt/n8n-check/examples
COPY --chown=node:node package.json /opt/n8n-check/package.json
USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/n8n-check/bin/n8n-check.mjs"]
