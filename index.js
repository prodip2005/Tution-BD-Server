const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const app = express();
const port = process.env.PORT || 3000;



app.use(cors());
app.use(express.json())


app.get('/', (req, res) => {
    res.send('Server is Running');
})



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d5x0yu5.mongodb.net/?appName=Cluster0`;



// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        // Send a ping to confirm a successful connection
        const db = client.db('tutor-owl');
        const userCollection = db.collection('users');
        const tuitionCollection = db.collection("tuitions");
        const applicationCollection = db.collection("applications");




        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = user.role || 'student';
            user.createAt = new Date();
            const email = user.email;
            const existUser = await userCollection.findOne({ email });
            if (existUser) {
                return res.send({ message: 'User Exist' });
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.post("/applications", async (req, res) => {
            try {
                const application = req.body;

                // 🔒 duplicate apply check
                const alreadyApplied = await applicationCollection.findOne({
                    tuitionId: application.tuitionId,
                    tutorEmail: application.tutorEmail,
                });

                if (alreadyApplied) {
                    return res.send({
                        success: false,
                        message: "Already applied",
                    });
                }

                // ✅ tuition থেকে budget আনো
                const tuition = await tuitionCollection.findOne({
                    _id: new ObjectId(application.tuitionId),
                });

                application.studentDemand = tuition?.budget || 0; // ⭐ MAIN FIX
                application.status = "pending";
                application.createdAt = new Date();

                const result = await applicationCollection.insertOne(application);
                res.send({ success: true, result });
            } catch (err) {
                res.status(500).send({ success: false, message: err.message });
            }
        });




        // server.js (or your current backend file) - add this after your other routes
        app.get('/users/:email', async (req, res) => {
            try {
                const rawEmail = req.params.email || '';
                if (!rawEmail) return res.status(400).send({ success: false, message: 'Email required' });

                const email = String(rawEmail).trim().toLowerCase();

                const user = await userCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ success: false, message: 'User not found' });
                }

                // optionally remove sensitive fields before sending
                // delete user.someSensitiveField;

                res.send({ success: true, user });
            } catch (err) {
                console.error('GET /users/:email error:', err);
                res.status(500).send({ success: false, message: err.message || 'Server error' });
            }
        });

        app.get("/applications", async (req, res) => {
            const email = req.query.email;

            const result = await applicationCollection
                .find({ tutorEmail: email })
                .toArray();

            res.send(result);
        });


        // GET applications for student (by studentEmail)
        app.get("/applications/student/:email", async (req, res) => {
            try {
                const email = req.params.email;

                const applications = await applicationCollection
                    .find({ studentEmail: email })
                    .toArray();

                res.send({ success: true, applications });
            } catch (err) {
                res.status(500).send({ success: false, message: err.message });
            }
        });


        app.get('/applications/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await applicationCollection.findOne(query);
            res.send(result);
        })




        app.put('/users/profile', async (req, res) => {
            try {
                const {
                    email,
                    name,
                    role,
                    image,
                    subjects,
                    institution,
                    level,
                    location,
                    phone,
                    bio,
                } = req.body;

                if (!email) {
                    return res.status(400).send({ success: false, message: 'Email is required' });
                }

                const normalizedEmail = String(email).trim().toLowerCase();

                const updateDoc = {
                    $set: {
                        email: normalizedEmail,
                        name: name || normalizedEmail.split('@')[0],
                        role: role || 'student',
                        image: image || null,

                        // 🔥 NEW PROFILE FIELDS
                        subjects: subjects || '',
                        institution: institution || '',
                        level: level || '',
                        location: location || '',
                        phone: phone || '',
                        bio: bio || '',

                        updatedAt: new Date(),
                    }
                };

                const result = await userCollection.updateOne(
                    { email: normalizedEmail },
                    updateDoc,
                    { upsert: true }
                );

                res.send({ success: true, result });
            } catch (err) {
                console.error('PUT /users/profile error:', err);
                res.status(500).send({ success: false, message: err.message });
            }
        });



        app.put("/applications/:id", async (req, res) => {
            const id = req.params.id;
            const { tutorEmail, qualifications, experience, expectedSalary } = req.body;

            const application = await applicationCollection.findOne({
                _id: new ObjectId(id),
            });

            if (!application) {
                return res.send({ success: false });
            }

            // 🔒 approved হলে edit করা যাবে না
            if (application.status !== "pending") {
                return res.send({ success: false });
            }

            // 🔒 security check
            if (application.tutorEmail !== tutorEmail) {
                return res.send({ success: false });
            }

            const result = await applicationCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        qualifications,
                        experience,
                        expectedSalary,
                        updatedAt: new Date(),
                    },
                }
            );

            res.send({ success: true, result });
        });



        // UPDATE tuition (only owner student can update)
        app.put("/tuitions/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;

                const { email } = updatedData;

                if (!email) {
                    return res.status(400).send({ success: false, message: "Email required" });
                }

                // find tuition first
                const tuition = await tuitionCollection.findOne({ _id: new ObjectId(id) });

                if (!tuition) {
                    return res.status(404).send({ success: false, message: "Tuition not found" });
                }

                // security check: only owner can update
                if (tuition.email !== email) {
                    return res.status(403).send({ success: false, message: "Unauthorized access" });
                }

                const updateDoc = {
                    $set: {
                        subject: updatedData.subject,
                        class: updatedData.class,
                        location: updatedData.location,
                        budget: updatedData.budget,
                        time: updatedData.time,
                        details: updatedData.details,
                        updatedAt: new Date()
                    }
                };

                const result = await tuitionCollection.updateOne(
                    { _id: new ObjectId(id) },
                    updateDoc
                );

                res.send({ success: true, result });
            } catch (err) {
                console.error("Update tuition error:", err);
                res.status(500).send({ success: false, message: err.message });
            }
        });


        // STUDENT → approve / reject tutor application
        app.patch("/applications/status/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { status, studentEmail } = req.body;

                if (!["approved", "rejected", "pending"].includes(status)) {
                    return res.status(400).send({ success: false });
                }

                const application = await applicationCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!application) {
                    return res.status(404).send({ success: false });
                }

                // 🔐 only owner student
                if (application.studentEmail !== studentEmail) {
                    return res.status(403).send({ success: false });
                }

                await applicationCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            status,
                            updatedAt: new Date(),
                        },
                    }
                );

                res.send({ success: true });
            } catch (err) {
                res.status(500).send({ success: false });
            }
        });




        // DELETE tuition (only owner student can delete)
        app.delete("/tuitions/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const email = req.query.email; // frontend থেকে query হিসেবে আসবে

                if (!email) {
                    return res.status(400).send({
                        success: false,
                        message: "Email required",
                    });
                }

                const tuition = await tuitionCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!tuition) {
                    return res.status(404).send({
                        success: false,
                        message: "Tuition not found",
                    });
                }

                // 🔐 security check
                if (tuition.email !== email) {
                    return res.status(403).send({
                        success: false,
                        message: "Unauthorized delete attempt",
                    });
                }

                const result = await tuitionCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                res.send({ success: true, result });
            } catch (err) {
                console.error("Delete tuition error:", err);
                res.status(500).send({
                    success: false,
                    message: err.message,
                });
            }
        });



        app.delete("/applications/:id", async (req, res) => {
            const id = req.params.id;
            const email = req.query.email;

            const application = await applicationCollection.findOne({
                _id: new ObjectId(id),
            });

            if (application.status !== "pending") {
                return res.send({ success: false });
            }

            if (application.tutorEmail !== email) {
                return res.send({ success: false });
            }

            await applicationCollection.deleteOne({ _id: new ObjectId(id) });
            res.send({ success: true });
        });




        app.post("/tuitions", async (req, res) => {
            try {
                const data = req.body;
                data.status = "pending";
                data.createdAt = new Date();

                const result = await tuitionCollection.insertOne(data);

                res.send({ success: true, result });
            } catch (err) {
                res.status(500).send({ success: false, message: err.message });
            }
        });


        app.get("/tuitions", async (req, res) => {
            const email = req.query.email;

            let query = {};
            if (email) {
                query.email = email;
            }

            const result = await tuitionCollection.find(query).toArray();
            res.send(result);
        });


        // get all tutors by role
        app.get("/tutors", async (req, res) => {
            try {
                const tutors = await userCollection
                    .find({ role: "tutor" })
                    .toArray();

                res.send({ success: true, tutors });
            } catch (err) {
                console.error("GET /tutors error:", err);
                res.status(500).send({ success: false, message: err.message });
            }
        });



        // STRIPE//

        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.expectedSalary) * 100

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {

                        price_data: {
                            currency: 'USD',
                            product_data: {
                                name: `Please pay for: ${paymentInfo.tuitionSubject}`
                            },
                            unit_amount: amount,
                        },
                        quantity: 1,
                    },
                ],
                customer_email: paymentInfo.studentEmail,
                mode: 'payment',
                metadata: {
                    applicationId: paymentInfo.applicationId
                },

                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })
            console.log(session);
            res.send({ url: session.url })

        })


        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            
            if (session.payment_status==='paid') {
                const id = session.metadata.applicationId;
                const query = { _id: new ObjectId(id) };
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        status: 'approved',
                        paidAt: new Date()
                    }
                }
                const result=await applicationCollection.updateOne(query,update)
                res.send(result)
            }
            
            res.send({success:true})
            
        })



        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.listen(port, () => {
    console.log(`App is running on port: ${port}`);

})