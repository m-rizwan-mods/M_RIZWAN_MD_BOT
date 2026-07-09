FROM quay.io/qasimtech/m-rizwan-md:latest

WORKDIR /root/mega-md

RUN git clone https://github.com/m-rizwan-mods/Rizwan-mdx-bot . && \
    npm install

EXPOSE 5000

CMD ["npm", "start"]
