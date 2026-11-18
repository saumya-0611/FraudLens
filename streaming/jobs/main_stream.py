"""
main_stream.py - PySpark Structured Streaming entrypoint for FraudLens (T1.2).

Reads `transactions-raw` from Kafka in `local[2]` mode with a 1-second micro-batch trigger
and delegates each micro-batch DataFrame to `pipeline.process_batch(df.toPandas(), batch_id)`.
If STREAM_ENGINE=fallback (or if Java/Spark runtime is unavailable), cleanly delegates to
`consumer_fallback.run_consumer()` which executes the exact same `process_batch` function.
"""
import importlib
import os

from streaming.jobs.consumer_fallback import run_consumer
from streaming.jobs.pipeline import process_batch


def run_spark_stream() -> None:
    pyspark_sql = importlib.import_module("pyspark.sql")
    pyspark_fn = importlib.import_module("pyspark.sql.functions")
    pyspark_types = importlib.import_module("pyspark.sql.types")

    SparkSession = pyspark_sql.SparkSession
    col = pyspark_fn.col
    from_json = pyspark_fn.from_json
    DoubleType = pyspark_types.DoubleType
    IntegerType = pyspark_types.IntegerType
    StringType = pyspark_types.StringType
    StructField = pyspark_types.StructField
    StructType = pyspark_types.StructType

    brokers = os.getenv("KAFKA_BROKERS", "kafka:9092")
    checkpoint_dir = os.getenv("SPARK_CHECKPOINT_DIR", "/tmp/spark-checkpoints")
    spark_pkg = os.getenv(
        "SPARK_KAFKA_PACKAGE",
        "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.3",
    )

    spark = (
        SparkSession.builder.appName("FraudLensStreaming")
        .master("local[2]")
        .config("spark.jars.packages", spark_pkg)
        .config("spark.sql.shuffle.partitions", "2")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")

    tx_schema = StructType(
        [
            StructField("transaction_id", StringType(), True),
            StructField("account_ref", StringType(), True),
            StructField("amount", DoubleType(), True),
            StructField("tx_time", StringType(), True),
            StructField("category", StringType(), True),
            StructField("merchant", StringType(), True),
            StructField("lat", DoubleType(), True),
            StructField("lon", DoubleType(), True),
            StructField("merch_lat", DoubleType(), True),
            StructField("merch_lon", DoubleType(), True),
            StructField("customer_age", IntegerType(), True),
            StructField("ingested_at", StringType(), True),
        ]
    )

    raw_stream = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", brokers)
        .option("subscribe", "transactions-raw")
        .option("startingOffsets", "earliest")
        .load()
    )

    parsed_stream = raw_stream.select(
        from_json(col("value").cast("string"), tx_schema).alias("tx")
    ).select("tx.*")

    def _on_batch(batch_df, batch_id: int) -> None:
        pdf = batch_df.toPandas()
        process_batch(pdf, batch_id)

    query = (
        parsed_stream.writeStream.foreachBatch(_on_batch)
        .trigger(processingTime="1 second")
        .option("checkpointLocation", checkpoint_dir)
        .start()
    )
    print(f"[streaming] PySpark Structured Streaming started on {brokers}...")
    query.awaitTermination()


if __name__ == "__main__":
    engine = os.getenv("STREAM_ENGINE", "spark").lower()
    if engine == "fallback":
        run_consumer()
    else:
        try:
            run_spark_stream()
        except Exception as exc:
            print(f"[streaming] Spark startup failed ({exc}); falling back to Python Kafka consumer...")
            run_consumer()
