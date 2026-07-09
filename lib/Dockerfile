FROM quay.io/qasimtech/m-rizwan-md:latest

WORKDIR /root/m-rizwan-md

COPY package.json package-lock.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "run", "start:optimized"]
