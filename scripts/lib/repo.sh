# shellcheck shell=bash
# Where this repository and its images live, defined once for the release and e2e scripts (sourced, not run).
# Both can be overridden from the environment, as the sign-off workflow does with its own repository and registry.
#
#   REPO             the GitHub repository, owner/name
#   IMAGE_REGISTRY   the registry and namespace of the eShop images: $IMAGE_REGISTRY/<service>:<tag>
REPO=${REPO:-pkhamdee/modernapp}
IMAGE_REGISTRY=${IMAGE_REGISTRY:-docker.io/pkhamdee}
