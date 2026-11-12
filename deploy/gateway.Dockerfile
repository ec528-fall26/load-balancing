FROM nginx:1.28-alpine
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 LBSIM_SERVICE_SUFFIX=""
COPY nginx.conf /etc/nginx/templates/default.conf.template
