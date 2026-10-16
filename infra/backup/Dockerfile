FROM postgres:17-alpine
RUN apk add --no-cache aws-cli util-linux && mkdir /backups && chown postgres:postgres /backups
COPY infra/backup/backup.sh /opt/backup.sh
USER postgres
ENTRYPOINT ["sh", "/opt/backup.sh"]
CMD ["loop"]
