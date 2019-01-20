
FROM node:8

WORKDIR /docparser

COPY . /docparser 

EXPOSE 4775 

RUN apt-get update 
RUN apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev graphicsmagick 

RUN npm install 

CMD ["./server/startServer"]

